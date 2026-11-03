import assert from 'node:assert/strict';
import test from 'node:test';
import { createStationSearchClient } from './stationSearchApi';

test('calls the local search endpoint with coordinates, radius, sort, products, and limit', async () => {
  let requestUrl = '';
  const client = createStationSearchClient('http://localhost:3000/', async (input) => {
    requestUrl = String(input);
    return Response.json({ stations: [], total: 0, limit: 20 });
  });

  const result = await client.search({
    latitude: 51.51,
    longitude: -0.74,
    miles: 5,
    sort: 'lowest-price',
    products: ['E5', 'E10'],
    limit: 20,
  });

  const url = new URL(requestUrl);
  assert.equal(url.origin, 'http://localhost:3000');
  assert.equal(url.pathname, '/api/stations/search');
  assert.equal(url.searchParams.get('latitude'), '51.51');
  assert.equal(url.searchParams.get('longitude'), '-0.74');
  assert.equal(url.searchParams.get('miles'), '5');
  assert.equal(url.searchParams.get('sort'), 'lowest-price');
  assert.equal(url.searchParams.get('product'), 'E5,E10');
  assert.equal(url.searchParams.get('limit'), '20');
  assert.equal(result.total, 0);
});

test('surfaces server errors and rejects malformed search responses', async () => {
  const serverErrorClient = createStationSearchClient('http://localhost:3000', async () =>
    Response.json({ error: 'Snapshot unavailable.' }, { status: 503 }));
  await assert.rejects(serverErrorClient.search({
    latitude: 0, longitude: 0, miles: 1, sort: 'closest', products: [], limit: 20,
  }), /Snapshot unavailable/);

  const malformedClient = createStationSearchClient('http://localhost:3000', async () => Response.json({ data: [] }));
  await assert.rejects(malformedClient.search({
    latitude: 0, longitude: 0, miles: 1, sort: 'closest', products: [], limit: 20,
  }), /did not contain a station array/);
});