import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fetchFuelData } from '../src/jobs/fetchFuelData.js';

test('collects station and price batches and atomically writes a JSON snapshot', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'fuelfinder-job-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'nested', 'fuel-data.json');
  const calls: string[] = [];
  const gateway = {
    getStations: async (batch: string) => {
      calls.push(`stations:${batch}`);
      return batch === '1' ? Response.json({ data: [{ node_id: 'node-1' }, { node_id: 'node-2' }] }) : new Response(null, { status: 204 });
    },
    getFuelPrices: async (batch: string) => {
      calls.push(`prices:${batch}`);
      return batch === '1'
        ? Response.json([
          { node_id: 'node-1', fuel_type: 'E10', price: 140 },
          { node_id: 'node-1', fuel_type: 'B7', price: 150 },
          { node_id: 'unmatched-node', fuel_type: 'E10', price: 160 },
        ])
        : Response.json({ data: [] });
    },
  };

  const snapshot = await fetchFuelData(gateway, filePath, {
    maxBatchNumber: 5,
    now: () => new Date('2026-11-03T12:00:00.000Z'),
  });
  const saved = JSON.parse(await readFile(filePath, 'utf8'));

  assert.deepEqual(snapshot, saved);
  assert.equal(saved.updatedAt, '2026-11-03T12:00:00.000Z');
  assert.deepEqual(saved.stations, [
    {
      node_id: 'node-1',
      fuelPrices: [
        { node_id: 'node-1', fuel_type: 'E10', price: 140 },
        { node_id: 'node-1', fuel_type: 'B7', price: 150 },
      ],
    },
    { node_id: 'node-2', fuelPrices: [] },
  ]);
  assert.deepEqual(saved.fuelPrices, [
    { node_id: 'node-1', fuel_type: 'E10', price: 140 },
    { node_id: 'node-1', fuel_type: 'B7', price: 150 },
    { node_id: 'unmatched-node', fuel_type: 'E10', price: 160 },
  ]);
  assert.deepEqual(calls, ['stations:1', 'prices:1', 'stations:2', 'prices:2']);
});

test('does not replace the previous snapshot when an upstream batch fails', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'fuelfinder-job-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'fuel-data.json');
  await writeFile(filePath, '{"previous":true}', 'utf8');

  await assert.rejects(fetchFuelData({
    getStations: async () => new Response('unavailable', { status: 503 }),
    getFuelPrices: async () => Response.json({ data: [] }),
  }, filePath), /stations batch 1 failed \(503\)/);

  assert.equal(await readFile(filePath, 'utf8'), '{"previous":true}');
});