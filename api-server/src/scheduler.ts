import 'dotenv/config';
import { createFuelFinderClient } from './fuelFinderClient.js';
import { fetchFuelData } from './jobs/fetchFuelData.js';
import { startScheduledJob } from './jobs/scheduler.js';
import { getFuelDataJobConfig, getFuelFinderConfig } from './config.js';

const client = createFuelFinderClient(getFuelFinderConfig());
const jobConfig = getFuelDataJobConfig();

async function runJob() {
  const snapshot = await fetchFuelData(client, jobConfig.dataFile, {
    maxBatchNumber: jobConfig.maxBatchNumber,
  });
  console.info(`Saved ${snapshot.stations.length} stations and ${snapshot.fuelPrices.length} fuel prices to ${jobConfig.dataFile}`);
}

if (process.argv.includes('--once')) {
  runJob().catch((error: unknown) => {
    console.error('Fuel data fetch failed:', error);
    process.exitCode = 1;
  });
} else {
  console.info(`Fuel data refresh scheduled every ${jobConfig.intervalMinutes} minute(s).`);
  startScheduledJob(runJob, jobConfig.intervalMs);
}