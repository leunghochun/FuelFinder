# Fuel Finder API Server

Standalone Node.js proxy for the Fuel Finder OAuth, station, and fuel-price APIs. OAuth credentials stay in this server's environment and are never sent to the mobile app.

## Run locally

Use Node.js 20.11 or newer. From this directory:

```powershell
npm install
Copy-Item .env.example .env
```

Set `FUEL_FINDER_CLIENT_ID` and `FUEL_FINDER_CLIENT_SECRET` in `.env`, then run:

```powershell
npm run dev
```

The service listens on `http://localhost:3000` by default. `CORS_ORIGINS` is a comma-separated origin allowlist; set it to the origin(s) that host the client. CORS is not authentication, so deploy behind your normal access controls and use HTTPS.

## Scheduled data snapshot

The background job fetches every station and fuel-price batch and writes a timestamped snapshot to `data/fuel-data.json`. It writes to a temporary file first, then renames it so a failed run does not replace the last successful snapshot. Generated JSON snapshots are git-ignored.

Build and start the API server:

```powershell
npm run build
npm start
```

Starting the API starts the refresh job in the background by default. Set `DATA_REFRESH_ENABLED=false` in `.env` to disable it while keeping the API routes running; set it to `true` to enable it. When enabled, it fetches immediately, then waits `DATA_REFRESH_INTERVAL_MINUTES` (default `60`) after each run before fetching again. `DATA_FILE` sets the output path, and `DATA_MAX_BATCH_NUMBER` sets the pagination safety limit. Each upstream request has a 60-second timeout by default; set `FUEL_FINDER_REQUEST_TIMEOUT_MS` to adjust it (maximum `2147483647`). The job does not block API requests, and a failed refresh is logged without stopping the server. These settings are read from `.env` at startup.

To fetch once without starting the API server, run `npm run fetch:data` after building. The background schedule runs only while the API server process is running; use a process supervisor to keep it alive in production.

The JSON contains `updatedAt`, `stations`, and `fuelPrices`. Each station also has a `fuelPrices` array containing records matched by `node_id`; stations without matching prices get an empty array. The top-level `fuelPrices` array retains all raw provider price records, including any that do not match a station. Station searches load this snapshot into memory once and use that cached copy; each successful scheduled refresh replaces the cache after writing the new file.

## Routes

- `GET /health` returns `{ "status": "ok" }`.
- `GET /api/stations?batch-number=1` proxies the Fuel Finder station batch.
- `GET /api/fuel-prices?batch-number=1` proxies the fuel-price batch.
- `GET /api/stations/search?latitude=51.5&longitude=-0.1&miles=10&sort=closest&limit=20` searches the local snapshot by radius.

For `sort=lowest-price`, an optional product such as `&sort=lowest-price&product=E10` restricts the sort to that fuel type. Product codes are case-insensitive and may be comma-separated for multiple selections. Without `product`, the lowest available fuel price is used. When products are specified, stations without a matching price are excluded. `SEARCH_MAX_LIMIT` (default `100`) caps the requested `limit`. The response contains `stations`, the effective `limit`, and the number of matches before limiting (`total`). Each result includes `distanceMiles`; lowest-price results also include `matchedPrice`.

The batch number is optional and defaults to `1`; supplied values must be positive integers. Upstream status codes and response bodies are passed through so the existing app's pagination behavior can continue to recognize empty batches, `204`, and `404` responses.

## Verify and build

```powershell
npm test
npm run build
npm start
```

This server is intentionally independent: it does not edit or automatically reconfigure the React Native app. The app would need a separate, deliberate change to point its requests at this service.