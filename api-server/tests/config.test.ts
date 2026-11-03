import assert from 'node:assert/strict';
import test from 'node:test';
import { getFuelDataJobConfig } from '../src/config.js';

test('enables data refresh by default and when explicitly true', () => {
  assert.equal(getFuelDataJobConfig({}).enabled, true);
  assert.equal(getFuelDataJobConfig({ DATA_REFRESH_ENABLED: 'true' }).enabled, true);
});

test('disables data refresh when explicitly false', () => {
  assert.equal(getFuelDataJobConfig({ DATA_REFRESH_ENABLED: 'false' }).enabled, false);
  assert.equal(getFuelDataJobConfig({ DATA_REFRESH_ENABLED: ' FALSE ' }).enabled, false);
});

test('rejects invalid data refresh setting', () => {
  assert.throws(
    () => getFuelDataJobConfig({ DATA_REFRESH_ENABLED: 'off' }),
    /DATA_REFRESH_ENABLED must be either true or false/,
  );
});