import assert from 'node:assert/strict';
import test from 'node:test';
import { createFuelFinderClient, FuelFinderConfig } from './fuelFinderApi';

const config: FuelFinderConfig = {
  clientId: 'test-client',
  clientSecret: 'test-secret',
  scope: 'fuelfinder.read',
  tokenUrl: 'https://fuel.example/oauth/token',
  apiUrl: 'https://fuel.example/api/v1/pfs',
  fuelPricesUrl: 'https://fuel.example/api/v1/pfs/fuel-prices',
};

test('requests and reuses an OAuth token for Bearer-authenticated station requests', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === config.tokenUrl) {
      return Response.json({
        success: 'true',
        data: { access_token: 'test-access-token', expires_in: 3600 },
      });
    }
    return Response.json([{ id: 'station-1' }]);
  };
  const client = createFuelFinderClient(config, fetchMock);

  const first = await client.getStations('2');
  const second = await client.getStations('3');
  const prices = await client.getFuelPrices('4');

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(prices.status, 200);
  assert.equal(requests.filter((request) => request.url === config.tokenUrl).length, 1);
  const tokenRequest = requests[0];
  assert.equal(tokenRequest.init?.method, 'POST');
  assert.equal(new Headers(tokenRequest.init?.headers).get('content-type'), 'application/x-www-form-urlencoded');
  assert.equal(tokenRequest.init?.body, new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: config.scope,
  }).toString());

  const stationRequests = requests.filter((request) => request.url.startsWith(config.apiUrl));
  assert.equal(new URL(stationRequests[0].url).searchParams.get('batch-number'), '2');
  assert.equal(new URL(stationRequests[1].url).searchParams.get('batch-number'), '3');
  assert.equal(new Headers(stationRequests[0].init?.headers).get('authorization'), 'Bearer test-access-token');
  const pricesRequest = requests.find((request) => request.url.startsWith(config.fuelPricesUrl));
  assert.ok(pricesRequest);
  assert.equal(new URL(pricesRequest.url).searchParams.get('batch-number'), '4');
  assert.equal(new Headers(pricesRequest.init?.headers).get('authorization'), 'Bearer test-access-token');
});

test('rejects missing credentials with setup guidance', async () => {
  const client = createFuelFinderClient({ ...config, clientId: '', clientSecret: '' });
  await assert.rejects(client.getAccessToken(), /Configure EXPO_PUBLIC_FUEL_FINDER_CLIENT_ID/);
});
