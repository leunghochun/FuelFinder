import assert from 'node:assert/strict';
import test from 'node:test';
import { startScheduledJob } from '../src/jobs/scheduler.js';

test('runs immediately and schedules the next run after completion', async () => {
  let runCount = 0;
  let resolveSecondRun: (() => void) | undefined;
  const secondRun = new Promise<void>((resolve) => {
    resolveSecondRun = resolve;
  });
  const stop = startScheduledJob(async () => {
    runCount += 1;
    if (runCount === 2) resolveSecondRun?.();
  }, 10);

  assert.equal(runCount, 1);
  await secondRun;
  stop();
  assert.equal(runCount, 2);
});

test('rejects a non-positive refresh interval', () => {
  assert.throws(() => startScheduledJob(async () => {}, 0), /intervalMs must be a positive safe integer/);
});