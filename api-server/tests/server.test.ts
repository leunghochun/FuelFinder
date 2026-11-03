import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../src/server.js';
import type { FuelFinderConfig } from '../src/fuelFinderClient.js';

const config: FuelFinderConfig = {
  clientId: 'test-client',
  clientSecret: 'test-secret',
  scope: 'fuelfinder.read',
  tokenUrl: 'https://fuel.example/oauth/token',
  apiUrl: 'https://fuel.example/api/v1/pfs',
  fuelPricesUrl: 'https://fuel.example/api/v1/pfs/fuel-prices',
};

test('proxies batch responses and rejects invalid batch numbers', async (context) => {
  const requestLogs: Array<Record<string, unknown>> = [];
  const fetchMock: typeof fetch = async (input) => {
    if (String(input) === config.tokenUrl) {
      return Response.json({ success: true, data: { access_token: 'server-token', expires_in: 3600 } });
    }
    return Response.json({ data: [{ id: 'station-1' }] });
  };
  const server = createApp(config, [], fetchMock, {
    info: (message) => requestLogs.push(JSON.parse(message) as Record<string, unknown>),
  }).listen(0);
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const validResponse = await fetch(`${baseUrl}/api/stations?batch-number=4`);
  assert.equal(validResponse.status, 200);
  assert.deepEqual(await validResponse.json(), { data: [{ id: 'station-1' }] });

  const invalidResponse = await fetch(`${baseUrl}/api/stations?batch-number=0`);
  assert.equal(invalidResponse.status, 400);

  const preflightResponse = await fetch(`${baseUrl}/api/stations`, { method: 'OPTIONS' });
  assert.equal(preflightResponse.status, 204);
  assert.deepEqual(requestLogs.map(({ method, path, statusCode }) => ({ method, path, statusCode })), [
    { method: 'GET', path: '/api/stations', statusCode: 200 },
    { method: 'GET', path: '/api/stations', statusCode: 400 },
    { method: 'OPTIONS', path: '/api/stations', statusCode: 204 },
  ]);
  assert.ok(requestLogs.every((log) => typeof log.durationMs === 'number'));
});

test('search endpoint reads snapshot and applies configured result cap', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'fuelfinder-search-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const dataFile = join(directory, 'fuel-data.json');
  await writeFile(dataFile, JSON.stringify({
    stations: [
      { node_id: 'closest', location: { latitude: 0, longitude: 0.01 }, fuelPrices: [] },
      { node_id: 'next', location: { latitude: 0, longitude: 0.02 }, fuelPrices: [] },
    ],
  }));
  const searchLogs: Array<Record<string, unknown>> = [];
  const server = createApp(config, [], fetch, {
    info: (message) => {
      const log = JSON.parse(message) as Record<string, unknown>;
      if (log.type === 'station_search') searchLogs.push(log);
    },
  }, { dataFile, maxLimit: 1 }).listen(0);
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const response = await fetch(`http://127.0.0.1:${address.port}/api/stations/search?latitude=0&longitude=0&miles=10&limit=10`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    stations: [{
      node_id: 'closest',
      location: { latitude: 0, longitude: 0.01 },
      fuelPrices: [],
      distanceMiles: (0.01 * Math.PI / 180) * 3958.8,
    }],
    limit: 1,
    total: 2,
  });
  assert.equal(searchLogs.length, 1);
  assert.equal(searchLogs[0].statusCode, 200);
  assert.equal(searchLogs[0].sort, 'closest');
  assert.equal(searchLogs[0].totalMatches, 2);
  assert.equal(searchLogs[0].returnedCount, 1);
  assert.equal(typeof searchLogs[0].durationMs, 'number');
});