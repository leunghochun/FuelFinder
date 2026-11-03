import assert from 'node:assert/strict';
import test from 'node:test';
import { createFuelFinderClient, type FuelFinderConfig } from '../src/fuelFinderClient.js';

const config: FuelFinderConfig = {
  clientId: 'test-client',
  clientSecret: 'test-secret',
  scope: 'fuelfinder.read',
  tokenUrl: 'https://fuel.example/oauth/token',
  apiUrl: 'https://fuel.example/api/v1/pfs',
  fuelPricesUrl: 'https://fuel.example/api/v1/pfs/fuel-prices',
};

test('uses one server-side token for station and fuel-price batches', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === config.tokenUrl) {
      return Response.json({ success: true, data: { access_token: 'server-token', expires_in: 3600 } });
    }
    return Response.json({ data: [] });
  };
  const client = createFuelFinderClient(config, fetchMock);

  await Promise.all([client.getStations('2'), client.getFuelPrices('3')]);

  assert.equal(requests.filter(({ url }) => url === config.tokenUrl).length, 1);
  const stationRequest = requests.find(({ url }) => url.startsWith(config.apiUrl));
  const pricesRequest = requests.find(({ url }) => url.startsWith(config.fuelPricesUrl));
  assert.ok(stationRequest);
  assert.ok(pricesRequest);
  assert.equal(new URL(stationRequest.url).searchParams.get('batch-number'), '2');
  assert.equal(new URL(pricesRequest.url).searchParams.get('batch-number'), '3');
  assert.equal(new Headers(stationRequest.init?.headers).get('authorization'), 'Bearer server-token');
  assert.equal(new Headers(pricesRequest.init?.headers).get('authorization'), 'Bearer server-token');
});

test('rejects missing server credentials', async () => {
  const client = createFuelFinderClient({ ...config, clientId: '', clientSecret: '' });
  await assert.rejects(client.getAccessToken(), /FUEL_FINDER_CLIENT_ID/);
});

test('reports the resource and batch when an upstream request times out', async () => {
  const fetchMock: typeof fetch = async (input) => {
    if (String(input) === config.tokenUrl) {
      return Response.json({ success: true, data: { access_token: 'server-token', expires_in: 3600 } });
    }
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  const client = createFuelFinderClient({ ...config, requestTimeoutMs: 42 }, fetchMock);

  await assert.rejects(client.getFuelPrices('7'), /Fuel-price batch 7 timed out after 42 ms/);
});