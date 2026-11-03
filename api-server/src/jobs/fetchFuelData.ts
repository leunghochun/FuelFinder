import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type FuelDataGateway = {
  getStations(batchNumber: string): Promise<Response>;
  getFuelPrices(batchNumber: string): Promise<Response>;
};

export type FuelDataSnapshot = {
  updatedAt: string;
  stations: unknown[];
  fuelPrices: unknown[];
};

type JobLogger = Pick<Console, 'info'>;

function nodeId(record: unknown): string | undefined {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const value = (record as Record<string, unknown>).node_id;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function joinFuelPrices(stations: unknown[], fuelPrices: unknown[]): unknown[] {
  const pricesByNodeId = new Map<string, unknown[]>();
  for (const price of fuelPrices) {
    const id = nodeId(price);
    if (!id) continue;
    const stationPrices = pricesByNodeId.get(id) ?? [];
    stationPrices.push(price);
    pricesByNodeId.set(id, stationPrices);
  }

  return stations.map((station) => {
    if (station === null || typeof station !== 'object' || Array.isArray(station)) return station;
    const id = nodeId(station);
    return { ...station, fuelPrices: id ? pricesByNodeId.get(id) ?? [] : [] };
  });
}

function extractRecords(payload: unknown): unknown[] | undefined {
  if (Array.isArray(payload)) return payload;
  if (payload === null || typeof payload !== 'object') return undefined;

  for (const key of ['stations', 'pfs', 'results', 'items', 'data']) {
    const records = (payload as Record<string, unknown>)[key];
    if (Array.isArray(records)) return records;
  }
  return undefined;
}

async function readBatch(response: Response, resource: string, batchNumber: number): Promise<unknown[]> {
  if (response.status === 204 || response.status === 404) return [];
  if (!response.ok) throw new Error(`${resource} batch ${batchNumber} failed (${response.status}).`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${resource} batch ${batchNumber} did not return valid JSON.`);
  }

  const records = extractRecords(payload);
  if (!records) throw new Error(`${resource} batch ${batchNumber} did not contain a data array.`);
  return records;
}

async function collectBatches(
  resource: 'stations' | 'fuel prices',
  fetchBatch: (batchNumber: string) => Promise<Response>,
  maxBatchNumber: number,
  logger: JobLogger,
): Promise<unknown[]> {
  const records: unknown[] = [];
  for (let batchNumber = 1; batchNumber <= maxBatchNumber; batchNumber += 1) {
    logger.info(`[Fuel data] Requesting ${resource} batch ${batchNumber}`);
    const response = await fetchBatch(String(batchNumber));
    const batchRecords = await readBatch(response, resource, batchNumber);
    logger.info(`[Fuel data] ${resource} batch ${batchNumber}: HTTP ${response.status}, ${batchRecords.length} records`);
    if (batchRecords.length === 0) return records;
    records.push(...batchRecords);
  }
  throw new Error(`${resource} did not return an empty batch before batch ${maxBatchNumber}.`);
}

export async function fetchFuelData(
  gateway: FuelDataGateway,
  filePath: string,
  options: { maxBatchNumber?: number; now?: () => Date; logger?: JobLogger } = {},
): Promise<FuelDataSnapshot> {
  const maxBatchNumber = options.maxBatchNumber ?? 1000;
  const logger = options.logger ?? console;
  if (!Number.isSafeInteger(maxBatchNumber) || maxBatchNumber < 1) {
    throw new Error('maxBatchNumber must be a positive safe integer.');
  }

  const [stations, fuelPrices] = await Promise.all([
    collectBatches('stations', gateway.getStations, maxBatchNumber, logger),
    collectBatches('fuel prices', gateway.getFuelPrices, maxBatchNumber, logger),
  ]);
  const snapshot = {
    updatedAt: (options.now ?? (() => new Date()))().toISOString(),
    stations: joinFuelPrices(stations, fuelPrices),
    fuelPrices,
  };

  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, filePath);
  } catch (error) {
    await import('node:fs/promises').then(({ rm }) => rm(temporaryPath, { force: true }));
    throw error;
  }

  return snapshot;
}