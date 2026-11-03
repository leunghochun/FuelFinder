import assert from 'node:assert/strict';
import test from 'node:test';
import { createFuelFinderService } from '../src/fuelFinderService.js';

test('defaults the batch number and selects the requested resource', async () => {
  const requested: string[] = [];
  const service = createFuelFinderService({
    getStations: async (batch) => {
      requested.push(`stations:${batch}`);
      return Response.json({ data: [] });
    },
    getFuelPrices: async (batch) => {
      requested.push(`prices:${batch}`);
      return Response.json({ data: [] });
    },
  });

  const stations = await service.getBatch('stations', undefined);
  const prices = await service.getBatch('fuel-prices', '3');

  assert.equal(stations.kind, 'upstream');
  assert.equal(prices.kind, 'upstream');
  assert.deepEqual(requested, ['stations:1', 'prices:3']);
});

test('rejects invalid batch numbers without calling the gateway', async () => {
  let called = false;
  const service = createFuelFinderService({
    getStations: async () => {
      called = true;
      return Response.json({});
    },
    getFuelPrices: async () => Response.json({}),
  });

  const result = await service.getBatch('stations', '99999999999999999999');

  assert.deepEqual(result, { kind: 'invalid', error: 'batch-number must be a positive integer.' });
  assert.equal(called, false);
});

test('maps gateway errors to a failure result', async () => {
  const service = createFuelFinderService({
    getStations: async () => { throw new Error('upstream unavailable'); },
    getFuelPrices: async () => Response.json({}),
  });

  assert.deepEqual(await service.getBatch('stations', '1'), { kind: 'failure' });
});