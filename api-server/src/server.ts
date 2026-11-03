import express, { type Request, type Response } from 'express';
import { createFuelFinderClient, type FuelFinderConfig } from './fuelFinderClient.js';
import { createFuelFinderService } from './fuelFinderService.js';
import { searchStations } from './stationSearch.js';
import { createSnapshotStore, type SnapshotStore } from './snapshotStore.js';

type RequestLogger = Pick<Console, 'info'>;

export function createApp(
  config: FuelFinderConfig,
  allowedOrigins: string[] = [],
  fetchImpl: typeof fetch = fetch,
  logger: RequestLogger = console,
  searchConfig: { dataFile: string; maxLimit: number; snapshotStore?: SnapshotStore } = {
    dataFile: './data/fuel-data.json',
    maxLimit: 100,
  },
) {
  const app = express();
  const client = createFuelFinderClient(config, fetchImpl);
  const service = createFuelFinderService(client);
  const snapshotStore = searchConfig.snapshotStore ?? createSnapshotStore(searchConfig.dataFile);

  app.use((request, response, next) => {
    const startedAt = process.hrtime.bigint();
    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info(JSON.stringify({
        type: 'http_request',
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Number(durationMs.toFixed(1)),
      }));
    });
    next();
  });

  app.use((request, response, next) => {
    const origin = request.get('origin');
    if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
      response.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes('*') ? '*' : origin);
      response.setHeader('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
      response.sendStatus(204);
      return;
    }
    next();
  });

  app.get('/health', (_request, response) => response.json({ status: 'ok' }));

  app.get('/api/stations/search', async (request, response) => {
    const startedAt = process.hrtime.bigint();
    let totalMatches: number | undefined;
    let returnedCount: number | undefined;
    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info(JSON.stringify({
        type: 'station_search',
        statusCode: response.statusCode,
        sort: request.query.sort === 'lowest-price' ? 'lowest-price' : 'closest',
        totalMatches,
        returnedCount,
        durationMs: Number(durationMs.toFixed(1)),
      }));
    });

    let snapshot: unknown;
    try {
      snapshot = await snapshotStore.getSnapshot();
    } catch {
      response.status(503).json({ error: 'Station data snapshot is unavailable.' });
      return;
    }

    const stations = snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>).stations
      : undefined;
    const result = searchStations(stations, request.query, searchConfig.maxLimit);
    if (result.kind === 'invalid') {
      response.status(result.error.startsWith('Station snapshot') ? 503 : 400).json({ error: result.error });
      return;
    }
    totalMatches = result.result.total;
    returnedCount = result.result.stations.length;
    const updatedAt = snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>).updatedAt
      : undefined;
    response.json({
      ...result.result,
      ...(typeof updatedAt === 'string' ? { updatedAt } : {}),
    });
  });

  async function proxyBatch(
    request: Request,
    response: Response,
    resource: 'stations' | 'fuel-prices',
  ) {
    const result = await service.getBatch(resource, request.query['batch-number']);
    if (result.kind === 'invalid') {
      response.status(400).json({ error: result.error });
      return;
    }
    if (result.kind === 'failure') {
      response.status(502).json({ error: 'Fuel Finder upstream request failed.' });
      return;
    }

    const contentType = result.response.headers.get('content-type');
    if (contentType) response.setHeader('Content-Type', contentType);
    response.status(result.response.status);
    if (result.response.status === 204 || result.response.status === 304) {
      response.end();
      return;
    }
    response.send(Buffer.from(await result.response.arrayBuffer()));
  }

  app.get('/api/stations', (request, response) => proxyBatch(request, response, 'stations'));
  app.get('/api/fuel-prices', (request, response) => proxyBatch(request, response, 'fuel-prices'));

  return app;
}