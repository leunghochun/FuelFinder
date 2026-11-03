import assert from 'node:assert/strict';
import test from 'node:test';
import { searchStations } from '../src/stationSearch.js';

const stations = [
  {
    node_id: 'near',
    location: { latitude: 0, longitude: 0.01 },
    fuelPrices: [{ fuel_prices: [{ fuel_type: 'E10', price: 180 }] }],
  },
  {
    node_id: 'cheap',
    location: { latitude: 0, longitude: 0.02 },
    fuelPrices: [{ fuel_prices: [{ fuel_type: 'e10', price: '150' }] }],
  },
  {
    node_id: 'no-product',
    location: { latitude: 0, longitude: 0.03 },
    fuelPrices: [{ fuel_prices: [{ fuel_type: 'B7_STANDARD', price: 140 }] }],
  },
  {
    node_id: 'outside',
    location: { latitude: 0, longitude: 1 },
    fuelPrices: [{ fuel_prices: [{ fuel_type: 'E10', price: 100 }] }],
  },
];

test('filters by radius, sorts by closest, and caps the requested limit', () => {
  const result = searchStations(stations, {
    latitude: '0',
    longitude: '0',
    miles: '10',
    sort: 'closest',
    limit: '50',
  }, 2);

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.equal(result.result.total, 3);
  assert.equal(result.result.limit, 2);
  assert.deepEqual(result.result.stations.map(({ node_id }) => node_id), ['near', 'cheap']);
  assert.ok(result.result.stations[0].distanceMiles < result.result.stations[1].distanceMiles);
});

test('sorts by lowest price for the selected product and uses distance for ties', () => {
  const result = searchStations(stations, {
    latitude: 0,
    longitude: 0,
    miles: 10,
    sort: 'lowest-price',
    product: 'E10',
  }, 10);

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.deepEqual(result.result.stations.map(({ node_id }) => node_id), ['cheap', 'near']);
  assert.deepEqual(result.result.stations[0].matchedPrice, { product: 'E10', price: 150 });
});

test('sorts by the lowest available fuel when no product is selected', () => {
  const result = searchStations(stations, {
    latitude: 0,
    longitude: 0,
    miles: 10,
    sort: 'lowest-price',
  }, 10);

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.deepEqual(result.result.stations.map(({ node_id }) => node_id), ['no-product', 'cheap', 'near']);
  assert.deepEqual(result.result.stations[0].matchedPrice, { product: 'B7_STANDARD', price: 140 });
});

test('filters and sorts using multiple selected products', () => {
  const result = searchStations(stations, {
    latitude: 0,
    longitude: 0,
    miles: 10,
    sort: 'lowest-price',
    product: 'E10,B7_STANDARD',
  }, 10);

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.deepEqual(result.result.stations.map(({ node_id }) => node_id), ['no-product', 'cheap', 'near']);
});

test('validates coordinates, radius, sort mode, and required product', () => {
  assert.equal(searchStations(stations, { latitude: 91, longitude: 0, miles: 1 }, 10).kind, 'invalid');
  assert.equal(searchStations(stations, { latitude: 0, longitude: 0, miles: 0 }, 10).kind, 'invalid');
  assert.equal(searchStations(stations, { latitude: 0, longitude: 0, miles: 1, sort: 'fastest' }, 10).kind, 'invalid');
  assert.equal(searchStations(stations, { latitude: 0, longitude: 0, miles: 1, product: ',' }, 10).kind, 'invalid');
});