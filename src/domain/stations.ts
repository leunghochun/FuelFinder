export type FuelPrice = {
  fuel: string;
  amount: number;
};

export type FuelStation = {
  id: string;
  name: string;
  brand: string;
  address: string;
  postcode: string;
  latitude: number;
  longitude: number;
  prices: FuelPrice[];
  distanceMiles?: number;
  sourceData?: Record<string, unknown>;
  priceSourceData?: Record<string, unknown>[];
};

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : undefined;
}

function firstValue(record: RecordValue, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function getRecordArray(payload: unknown): unknown[] | undefined {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return undefined;

  for (const key of ['stations', 'pfs', 'results', 'items', 'data']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return undefined;
}

function stationRecords(payload: unknown): unknown[] {
  return getRecordArray(payload) ?? [];
}

function extractPrices(record: RecordValue): FuelPrice[] {
  const rawPrices = firstValue(record, ['fuelPrices', 'prices', 'fuel_prices']);
  if (Array.isArray(rawPrices)) {
    return rawPrices.flatMap((rawPrice) => {
      const item = asRecord(rawPrice);
      if (!item) return [];
      const nestedPrices = firstValue(item, ['fuelPrices', 'fuel_prices']);
      if (Array.isArray(nestedPrices)) return extractPrices({ fuel_prices: nestedPrices });
      const amount = numericValue(firstValue(item, ['price', 'amount', 'value', 'pricePence', 'price_pence']));
      const fuel = textValue(firstValue(item, ['fuelType', 'fuel_type', 'fuel', 'type', 'product', 'name']), 'Fuel');
      return amount === undefined ? [] : [{ fuel, amount }];
    });
  }

  if (rawPrices && typeof rawPrices === 'object') {
    return Object.entries(rawPrices as Record<string, unknown>).flatMap(([fuel, rawAmount]) => {
      const amount = numericValue(rawAmount);
      return amount === undefined ? [] : [{ fuel, amount }];
    });
  }
  return [];
}

export function normalizeStations(payload: unknown): FuelStation[] {
  return stationRecords(payload).flatMap((rawStation, index) => {
    const record = asRecord(rawStation);
    if (!record) return [];
    const location = asRecord(firstValue(record, ['location', 'coordinates', 'geolocation', 'geo'])) ?? {};
    const latitude = numericValue(firstValue(record, ['latitude', 'lat']) ?? firstValue(location, ['latitude', 'lat']))
      ?? numericValue(Array.isArray(record.coordinates) ? record.coordinates[1] : undefined);
    const longitude = numericValue(firstValue(record, ['longitude', 'lon', 'lng']) ?? firstValue(location, ['longitude', 'lon', 'lng']))
      ?? numericValue(Array.isArray(record.coordinates) ? record.coordinates[0] : undefined);
    if (latitude === undefined || longitude === undefined || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return [];

    const name = textValue(firstValue(record, ['tradingName', 'trading_name', 'name', 'stationName', 'siteName']), 'Fuel station');
    const brand = textValue(firstValue(record, ['brandName', 'brand_name', 'brand', 'operator']), name);
    const address = textValue(
      firstValue(record, ['address', 'addressLine1', 'street', 'town'])
        ?? firstValue(location, ['address_line_1', 'address_line_2', 'city']),
    );
    const postcode = textValue(
      firstValue(record, ['postcode', 'postalCode', 'postCode']) ?? firstValue(location, ['postcode']),
    );
    const id = textValue(firstValue(record, ['node_id', 'pfsId', 'id', 'stationId', 'siteId']), `${latitude},${longitude},${index}`);

    return [{
      id,
      name,
      brand,
      address,
      postcode,
      latitude,
      longitude,
      prices: extractPrices(record),
      distanceMiles: numericValue(record.distanceMiles),
      sourceData: record,
      priceSourceData: Array.isArray(record.fuelPrices)
        ? record.fuelPrices.flatMap((item) => {
          const value = asRecord(item);
          return value ? [value] : [];
        })
        : [],
    }];
  });
}

export function mergeFuelPrices(stations: FuelStation[], payload: unknown): FuelStation[] {
  const pricesByStation = new Map<string, FuelPrice[]>();
  const sourceDataByStation = new Map<string, RecordValue[]>();

  stationRecords(payload).forEach((rawPrice) => {
    const record = asRecord(rawPrice);
    if (!record) return;

    const stationId = textValue(firstValue(record, ['node_id', 'pfsId', 'stationId', 'forecourtId', 'siteId']));
    if (!stationId) return;

    const sourceRecords = sourceDataByStation.get(stationId) ?? [];
    sourceRecords.push(record);
    sourceDataByStation.set(stationId, sourceRecords);

    const nestedPrices = extractPrices(record);
    const amount = numericValue(firstValue(record, ['price', 'amount', 'value', 'pricePence', 'price_pence']));
    const flatPrices = amount === undefined
      ? []
      : [{
        fuel: textValue(firstValue(record, ['fuelType', 'fuel_type', 'fuel', 'type', 'product']), 'Fuel'),
        amount,
      }];
    const stationPrices = pricesByStation.get(stationId) ?? [];
    stationPrices.push(...(nestedPrices.length > 0 ? nestedPrices : flatPrices));
    pricesByStation.set(stationId, stationPrices);
  });

  return stations.map((station) => ({
    ...station,
    prices: [...station.prices, ...(pricesByStation.get(station.id) ?? [])],
    priceSourceData: sourceDataByStation.get(station.id) ?? [],
  }));
}

export async function collectRecordBatches(
  fetchBatch: (batchNumber: string) => Promise<unknown>,
  resourceName: string,
  maxBatchNumber = 1000,
): Promise<unknown[]> {
  const records: unknown[] = [];
  for (let batchNumber = 1; batchNumber <= maxBatchNumber; batchNumber += 1) {
    const payload = await fetchBatch(String(batchNumber));
    const batchRecords = getRecordArray(payload);
    if (!batchRecords) {
      throw new Error(`Fuel Finder ${resourceName} batch ${batchNumber} did not contain a data array.`);
    }
    if (batchRecords.length === 0) return records;
    records.push(...batchRecords);
  }

  throw new Error(`Fuel Finder ${resourceName} did not return an empty batch before batch ${maxBatchNumber}.`);
}

export function distanceMiles(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function sortByDistance(
  stations: FuelStation[],
  location?: { latitude: number; longitude: number },
): FuelStation[] {
  if (!location) return stations;
  return stations
    .map((station) => ({ ...station, distanceMiles: distanceMiles(location, station) }))
    .sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));
}

export function stationsWithinRadius(
  stations: FuelStation[],
  location: { latitude: number; longitude: number } | undefined,
  radiusMiles: number,
): FuelStation[] {
  if (!location || radiusMiles <= 0) return [];
  const nearby: FuelStation[] = [];
  for (const station of stations) {
    const distance = distanceMiles(location, station);
    if (distance <= radiusMiles) nearby.push({ ...station, distanceMiles: distance });
  }
  return nearby.sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));
}