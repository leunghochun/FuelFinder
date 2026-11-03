import { resolve } from 'node:path';
import type { FuelFinderConfig } from './fuelFinderClient.js';

export function getFuelFinderConfig(): FuelFinderConfig {
  const requestTimeoutMs = Number(process.env.FUEL_FINDER_REQUEST_TIMEOUT_MS || 60_000);
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 2_147_483_647) {
    throw new Error('FUEL_FINDER_REQUEST_TIMEOUT_MS must be a positive integer no greater than 2147483647.');
  }

  return {
    clientId: process.env.FUEL_FINDER_CLIENT_ID ?? '',
    clientSecret: process.env.FUEL_FINDER_CLIENT_SECRET ?? '',
    scope: process.env.FUEL_FINDER_SCOPE || 'fuelfinder.read',
    tokenUrl: process.env.FUEL_FINDER_TOKEN_URL
      || 'https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_access_token',
    apiUrl: process.env.FUEL_FINDER_API_URL || 'https://www.fuel-finder.service.gov.uk/api/v1/pfs',
    fuelPricesUrl: process.env.FUEL_FINDER_PRICES_API_URL
      || 'https://www.fuel-finder.service.gov.uk/api/v1/pfs/fuel-prices',
    requestTimeoutMs,
  };
}

export function getFuelDataJobConfig(env: NodeJS.ProcessEnv = process.env) {
  const enabledValue = env.DATA_REFRESH_ENABLED?.trim().toLowerCase();
  if (enabledValue !== undefined && enabledValue !== 'true' && enabledValue !== 'false') {
    throw new Error('DATA_REFRESH_ENABLED must be either true or false.');
  }
  const intervalMinutes = Number(env.DATA_REFRESH_INTERVAL_MINUTES || 60);
  const maxBatchNumber = Number(env.DATA_MAX_BATCH_NUMBER || 1000);
  if (!Number.isSafeInteger(intervalMinutes) || intervalMinutes < 1) {
    throw new Error('DATA_REFRESH_INTERVAL_MINUTES must be a positive integer.');
  }
  if (!Number.isSafeInteger(maxBatchNumber) || maxBatchNumber < 1) {
    throw new Error('DATA_MAX_BATCH_NUMBER must be a positive integer.');
  }

  return {
    enabled: enabledValue !== 'false',
    dataFile: resolve(env.DATA_FILE || './data/fuel-data.json'),
    intervalMinutes,
    intervalMs: intervalMinutes * 60_000,
    maxBatchNumber,
  };
}

export function getServerConfig() {
  const searchMaxLimit = Number(process.env.SEARCH_MAX_LIMIT || 100);
  if (!Number.isSafeInteger(searchMaxLimit) || searchMaxLimit < 1) {
    throw new Error('SEARCH_MAX_LIMIT must be a positive integer.');
  }

  return {
    port: Number(process.env.PORT) || 3000,
    searchMaxLimit,
    allowedOrigins: (process.env.CORS_ORIGINS || 'http://localhost:8081')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}