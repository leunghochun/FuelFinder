import 'dotenv/config';
import { createFuelFinderClient } from './fuelFinderClient.js';
import { getFuelDataJobConfig, getFuelFinderConfig, getServerConfig } from './config.js';
import { fetchFuelData } from './jobs/fetchFuelData.js';
import { startScheduledJob } from './jobs/scheduler.js';
import { createApp } from './server.js';
import { createSnapshotStore } from './snapshotStore.js';

const fuelFinderConfig = getFuelFinderConfig();
const serverConfig = getServerConfig();
const jobConfig = getFuelDataJobConfig();
const client = createFuelFinderClient(fuelFinderConfig);
const snapshotStore = createSnapshotStore(jobConfig.dataFile);

createApp(fuelFinderConfig, serverConfig.allowedOrigins, fetch, console, {
  dataFile: jobConfig.dataFile,
  maxLimit: serverConfig.searchMaxLimit,
  snapshotStore,
}).listen(serverConfig.port, () => {
  console.info(`Fuel Finder API server listening on port ${serverConfig.port}`);
  if (jobConfig.enabled) {
    console.info(`Fuel data refresh runs immediately and then every ${jobConfig.intervalMinutes} minute(s).`);
    startScheduledJob(async () => {
      const snapshot = await fetchFuelData(client, jobConfig.dataFile, {
        maxBatchNumber: jobConfig.maxBatchNumber,
      });
      snapshotStore.replace(snapshot);
      console.info(`Saved ${snapshot.stations.length} stations and ${snapshot.fuelPrices.length} fuel prices to ${jobConfig.dataFile}`);
    }, jobConfig.intervalMs);
  } else {
    console.info('Fuel data refresh scheduler is disabled.');
  }
});