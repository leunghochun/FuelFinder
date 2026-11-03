import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSnapshotStore } from '../src/snapshotStore.js';

test('loads the snapshot once, then serves and replaces it from memory', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'fuelfinder-snapshot-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'fuel-data.json');
  await writeFile(filePath, JSON.stringify({ version: 1, stations: [] }));
  const store = createSnapshotStore(filePath);

  assert.deepEqual(await store.getSnapshot(), { version: 1, stations: [] });
  await writeFile(filePath, JSON.stringify({ version: 2, stations: [] }));
  assert.deepEqual(await store.getSnapshot(), { version: 1, stations: [] });

  store.replace({ version: 3, stations: [] });
  assert.deepEqual(await store.getSnapshot(), { version: 3, stations: [] });
});

test('retries disk loading after a missing snapshot error', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'fuelfinder-snapshot-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'fuel-data.json');
  const store = createSnapshotStore(filePath);

  await assert.rejects(store.getSnapshot());
  await writeFile(filePath, JSON.stringify({ stations: [] }));
  assert.deepEqual(await store.getSnapshot(), { stations: [] });
});