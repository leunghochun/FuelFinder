import assert from 'node:assert/strict';
import test from 'node:test';
import { collectRecordBatches, distanceMiles, getRecordArray, mergeFuelPrices, normalizeStations, sortByDistance, stationsWithinRadius } from './stations';
import { readBatchResponse } from '../services/batchResponse';

test('normalizes wrapped station records and fuel prices', () => {
  const stations = normalizeStations({
    data: [{
      pfsId: 'station-1',
      tradingName: 'Central Fuel',
      brandName: 'Central',
      location: { latitude: 51.5, longitude: -0.12 },
      fuelPrices: [{ fuelType: 'E10', price: 149.9 }],
    }],
  });

  assert.equal(stations.length, 1);
  assert.equal(stations[0].name, 'Central Fuel');
  assert.equal(stations[0].prices[0].fuel, 'E10');
  assert.equal(stations[0].prices[0].amount, 149.9);
  assert.deepEqual(stations[0].sourceData, {
    pfsId: 'station-1',
    tradingName: 'Central Fuel',
    brandName: 'Central',
    location: { latitude: 51.5, longitude: -0.12 },
    fuelPrices: [{ fuelType: 'E10', price: 149.9 }],
  });
});

test('supports GeoJSON coordinate order and skips records without coordinates', () => {
  const stations = normalizeStations([
    { id: 'geo', coordinates: [-0.12, 51.5] },
    { id: 'missing' },
  ]);

  assert.equal(stations.length, 1);
  assert.equal(stations[0].latitude, 51.5);
  assert.equal(stations[0].longitude, -0.12);
});

test('normalizes and preserves the complete station API record', () => {
  const record = {
    node_id: '9b275ab576eeba3c6677984be15ee22a74e54fdfe8e5ea700e84a03178dc4ac1',
    public_phone_number: null,
    trading_name: 'TEST',
    is_same_trading_and_brand_name: true,
    brand_name: 'TEST',
    temporary_closure: false,
    permanent_closure: false,
    permanent_closure_date: null,
    is_motorway_service_station: false,
    is_supermarket_service_station: false,
    location: {
      address_line_1: 'HALL & WOODHOUSE, TAPLOW BOATYARD, MILL LANE, TAPLOW, MAIDENHEAD, SL6 0AA',
      address_line_2: null,
      city: 'MAIDENHEAD',
      country: 'England',
      county: null,
      postcode: 'SL6 0AA',
      latitude: 51.5268585,
      longitude: -0.700361,
    },
    amenities: ['water_filling'],
    opening_times: {
      usual_days: {
        monday: {},
        tuesday: {},
        wednesday: {},
        thursday: {},
        friday: {},
        saturday: {},
        sunday: {},
      },
      bank_holiday: {
        type: 'bank holiday',
        open_time: '00:00:00',
        close_time: '00:00:00',
        is_24_hours: false,
      },
    },
    fuel_types: ['E10', 'E5', 'HVO', 'B10'],
  };
  const [station] = normalizeStations({ data: [record] });

  assert.equal(station.id, record.node_id);
  assert.equal(station.name, 'TEST');
  assert.equal(station.brand, 'TEST');
  assert.equal(station.address, record.location.address_line_1);
  assert.equal(station.postcode, 'SL6 0AA');
  assert.equal(station.latitude, 51.5268585);
  assert.equal(station.longitude, -0.700361);
  assert.deepEqual(station.sourceData, record);
});

test('calculates and sorts station distances in miles', () => {
  const london = { latitude: 51.5074, longitude: -0.1278 };
  const stations = normalizeStations([
    { id: 'far', latitude: 51.6, longitude: -0.1 },
    { id: 'near', latitude: 51.51, longitude: -0.13 },
  ]);
  const sorted = sortByDistance(stations, london);

  assert.equal(sorted[0].id, 'near');
  assert.ok((sorted[0].distanceMiles ?? Infinity) < (sorted[1].distanceMiles ?? 0));
  assert.equal(distanceMiles(london, london), 0);
});

test('merges fuel-price records onto stations by forecourt ID', () => {
  const stations = normalizeStations([
    { node_id: 'pfs-1', trading_name: 'Central Fuel', latitude: 51.5, longitude: -0.12 },
    { node_id: 'pfs-2', trading_name: 'Other Fuel', latitude: 51.6, longitude: -0.2 },
  ]);
  const merged = mergeFuelPrices(stations, {
    data: [
      {
        node_id: 'pfs-1',
        public_phone_number: 123456789,
        trading_name: 'Central Fuel',
        fuel_prices: [
          { fuel_type: 'E10', price: '149.9', price_last_updated: '2026-11-02T10:00:00Z' },
          { fuel_type: 'B7', price: '155.2', price_change_effective_timestamp: '2026-11-02T10:00:00Z' },
        ],
      },
      {
        node_id: 'unknown',
        trading_name: 'Unknown Fuel',
        fuel_prices: [{ fuel_type: 'E10', price: '140.1' }],
      },
    ],
  });

  assert.deepEqual(merged[0].prices, [
    { fuel: 'E10', amount: 149.9 },
    { fuel: 'B7', amount: 155.2 },
  ]);
  assert.deepEqual(merged[0].priceSourceData, [{
    node_id: 'pfs-1',
    public_phone_number: 123456789,
    trading_name: 'Central Fuel',
    fuel_prices: [
      { fuel_type: 'E10', price: '149.9', price_last_updated: '2026-11-02T10:00:00Z' },
      { fuel_type: 'B7', price: '155.2', price_change_effective_timestamp: '2026-11-02T10:00:00Z' },
    ],
  }]);
  assert.deepEqual(merged[1].prices, []);
});

test('collects station records until an explicit empty batch', async () => {
  const requestedBatches: string[] = [];
  const stationRecords = await collectRecordBatches(async (batchNumber) => {
    requestedBatches.push(batchNumber);
    if (batchNumber === '1') {
      return { data: [
        { node_id: 'pfs-1', trading_name: 'One Stop', latitude: 51.5, longitude: -0.12 },
        { node_id: 'pfs-2', trading_name: 'Two Stop', latitude: 51.6, longitude: -0.2 },
      ] };
    }
    if (batchNumber === '2') {
      return { data: [{ node_id: 'pfs-3', trading_name: 'Three Stop', latitude: 51.7, longitude: -0.3 }] };
    }
    return { data: [] };
  }, 'station');

  assert.deepEqual(requestedBatches, ['1', '2', '3']);
  assert.deepEqual(normalizeStations(stationRecords).map((station) => station.id), ['pfs-1', 'pfs-2', 'pfs-3']);
  assert.equal(getRecordArray({ success: true }), undefined);
});

test('stops pagination when the API returns HTTP 404 for the next batch', async () => {
  const requestedBatches: string[] = [];
  const stationRecords = await collectRecordBatches(async (batchNumber) => {
    requestedBatches.push(batchNumber);
    const response = batchNumber === '1'
      ? Response.json({ data: [{ node_id: 'pfs-1', trading_name: 'One Stop', latitude: 51.5, longitude: -0.12 }] })
      : new Response(null, { status: 404 });

    return readBatchResponse(response);
  }, 'station');

  assert.deepEqual(requestedBatches, ['1', '2']);
  assert.deepEqual(normalizeStations(stationRecords).map((station) => station.id), ['pfs-1']);
});

test('joins independently collected price records to stations by node_id', async () => {
  const stationsPayloads = [
    { data: [{ node_id: 'station-1', trading_name: 'One Stop', latitude: 51.5, longitude: -0.12 }] },
    { data: [] },
  ];
  const pricesPayloads = [
    { data: [{ node_id: 'station-1', fuel_prices: [{ fuel_type: 'E10', price: '149.9' }] }] },
    { data: [{ node_id: 'station-1', fuel_prices: [{ fuel_type: 'B7', price: '155.2' }] }] },
    { data: [] },
  ];
  const stationRecords = await collectRecordBatches(async (batchNumber) => stationsPayloads[Number(batchNumber) - 1], 'station');
  const priceRecords = await collectRecordBatches(async (batchNumber) => pricesPayloads[Number(batchNumber) - 1], 'fuel price');

  const prices = mergeFuelPrices(normalizeStations(stationRecords), priceRecords)[0].prices;
  assert.deepEqual(prices.map(({ fuel, amount }) => ({ fuel, amount })), [
    { fuel: 'E10', amount: 149.9 },
    { fuel: 'B7', amount: 155.2 },
  ]);
  assert.equal(prices[0].fuel, 'E10');
  assert.equal(prices[0].amount, 149.9);
  assert.equal(mergeFuelPrices(normalizeStations(stationRecords), priceRecords)[0].priceSourceData?.[0].node_id, 'station-1');
});

test('limits displayed stations to the selected radius', () => {
  const location = { latitude: 51.5074, longitude: -0.1278 };
  const stations = normalizeStations([
    { id: 'nearer', latitude: 51.51, longitude: -0.13 },
    { id: 'near', latitude: 51.52, longitude: -0.13 },
    { id: 'far', latitude: 51.62, longitude: -0.13 },
  ]);

  const nearby = stationsWithinRadius(stations, location, 5);
  assert.deepEqual(nearby.map((station) => station.id), ['nearer', 'near']);
  assert.ok(nearby.every((station) => station.distanceMiles !== undefined && station.distanceMiles <= 5));
  assert.deepEqual(stationsWithinRadius(stations, undefined, 5), []);
  assert.deepEqual(stationsWithinRadius(stations, location, 0), []);
});

test('normalizes stations and nested prices returned by the search API', () => {
  const [station] = normalizeStations([{
    node_id: 'node-search-1',
    trading_name: 'Search Fuel',
    brand_name: 'Search',
    location: { latitude: 51.51, longitude: -0.74, postcode: 'SW1A 1AA' },
    distanceMiles: 1.25,
    fuelPrices: [{
      node_id: 'node-search-1',
      fuel_prices: [
        { fuel_type: 'E5', price: '145.9' },
        { fuel_type: 'E10', price: 139.9 },
      ],
    }],
  }]);

  assert.equal(station.id, 'node-search-1');
  assert.equal(station.distanceMiles, 1.25);
  assert.deepEqual(station.prices, [
    { fuel: 'E5', amount: 145.9 },
    { fuel: 'E10', amount: 139.9 },
  ]);
  assert.equal(station.priceSourceData?.length, 1);
});