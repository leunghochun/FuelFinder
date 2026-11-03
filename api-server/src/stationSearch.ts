export type StationSearchOptions = {
  latitude: number;
  longitude: number;
  miles: number;
  sort: 'closest' | 'lowest-price';
  product?: string;
  limit: number;
};

export type StationSearchResult = {
  stations: Array<Record<string, unknown> & {
    distanceMiles: number;
    matchedPrice?: { product: string; price: number };
  }>;
  limit: number;
  total: number;
};

type SearchResult =
  | { kind: 'success'; result: StationSearchResult }
  | { kind: 'invalid'; error: string };

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function distanceMiles(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getCoordinates(station: RecordValue): { latitude: number; longitude: number } | undefined {
  const location = asRecord(station.location) ?? {};
  const latitude = numberValue(station.latitude ?? station.lat ?? location.latitude ?? location.lat);
  const longitude = numberValue(station.longitude ?? station.lon ?? station.lng ?? location.longitude ?? location.lon ?? location.lng);
  if (latitude === undefined || longitude === undefined
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  return { latitude, longitude };
}

function findProductPrice(station: RecordValue, products?: Set<string>): { product: string; price: number } | undefined {
  const stationPriceRecords = Array.isArray(station.fuelPrices) ? station.fuelPrices : [];
  let lowestPrice: { product: string; price: number } | undefined;

  for (const rawRecord of stationPriceRecords) {
    const record = asRecord(rawRecord);
    if (!record) continue;
    const nestedPrices = Array.isArray(record.fuel_prices) ? record.fuel_prices
      : Array.isArray(record.fuelPrices) ? record.fuelPrices
        : [record];
    for (const rawPrice of nestedPrices) {
      const priceRecord = asRecord(rawPrice);
      if (!priceRecord) continue;
      const fuelType = priceRecord.fuel_type ?? priceRecord.fuelType ?? priceRecord.fuel ?? priceRecord.type;
      const price = numberValue(priceRecord.price ?? priceRecord.amount ?? priceRecord.value);
      const normalizedFuel = typeof fuelType === 'string' ? fuelType.trim().toUpperCase() : undefined;
      if (normalizedFuel && (!products || products.has(normalizedFuel)) && price !== undefined && price >= 0
        && (!lowestPrice || price < lowestPrice.price)) {
        lowestPrice = { product: normalizedFuel, price };
      }
    }
  }

  return lowestPrice;
}

export function searchStations(
  rawStations: unknown,
  query: Record<string, unknown>,
  maxLimit: number,
): SearchResult {
  if (!Array.isArray(rawStations)) return { kind: 'invalid', error: 'Station snapshot is unavailable or invalid.' };
  if (!Number.isSafeInteger(maxLimit) || maxLimit < 1) {
    return { kind: 'invalid', error: 'Search maximum limit is not configured correctly.' };
  }

  const latitude = numberValue(query.latitude);
  const longitude = numberValue(query.longitude);
  const miles = numberValue(query.miles);
  if (latitude === undefined || latitude < -90 || latitude > 90) {
    return { kind: 'invalid', error: 'latitude must be a number from -90 to 90.' };
  }
  if (longitude === undefined || longitude < -180 || longitude > 180) {
    return { kind: 'invalid', error: 'longitude must be a number from -180 to 180.' };
  }
  if (miles === undefined || miles <= 0) {
    return { kind: 'invalid', error: 'miles must be a positive number.' };
  }

  const sortValue = query.sort === undefined ? 'closest' : query.sort;
  if (sortValue !== 'closest' && sortValue !== 'lowest-price') {
    return { kind: 'invalid', error: 'sort must be "closest" or "lowest-price".' };
  }
  const productValue = query.product;
  if (productValue !== undefined && (typeof productValue !== 'string' || productValue.trim() === '')) {
    return { kind: 'invalid', error: 'product must be a non-empty product code or comma-separated product codes.' };
  }

  const requestedLimit = query.limit === undefined ? 20 : numberValue(query.limit);
  if (requestedLimit === undefined || !Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    return { kind: 'invalid', error: 'limit must be a positive integer.' };
  }
  const limit = Math.min(requestedLimit, maxLimit);
  const products = typeof productValue === 'string'
    ? new Set(productValue.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean))
    : undefined;
  if (productValue !== undefined && products?.size === 0) {
    return { kind: 'invalid', error: 'product must contain at least one product code.' };
  }

  const matches: StationSearchResult['stations'] = [];
  for (const rawStation of rawStations) {
    const station = asRecord(rawStation);
    if (!station) continue;
    const coordinates = getCoordinates(station);
    if (!coordinates) continue;
    const distance = distanceMiles({ latitude, longitude }, coordinates);
    if (distance > miles) continue;

    const matchedPrice = products || sortValue === 'lowest-price'
      ? findProductPrice(station, products)
      : undefined;
    if ((products || sortValue === 'lowest-price') && !matchedPrice) continue;

    if (sortValue === 'lowest-price') {
      matches.push({ ...station, distanceMiles: distance, matchedPrice });
      continue;
    }
    matches.push({ ...station, distanceMiles: distance, ...(matchedPrice ? { matchedPrice } : {}) });
  }

  matches.sort((left, right) => {
    if (sortValue === 'lowest-price') {
      const priceDifference = (left.matchedPrice?.price ?? Infinity) - (right.matchedPrice?.price ?? Infinity);
      if (priceDifference !== 0) return priceDifference;
    }
    return left.distanceMiles - right.distanceMiles;
  });

  return { kind: 'success', result: { stations: matches.slice(0, limit), limit, total: matches.length } };
}