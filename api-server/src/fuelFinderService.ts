type FuelFinderGateway = {
  getStations(batchNumber: string): Promise<Response>;
  getFuelPrices(batchNumber: string): Promise<Response>;
};

export type BatchResult =
  | { kind: 'upstream'; response: Response }
  | { kind: 'invalid'; error: string }
  | { kind: 'failure' };

export function createFuelFinderService(gateway: FuelFinderGateway) {
  async function getBatch(resource: 'stations' | 'fuel-prices', requestedBatch: unknown): Promise<BatchResult> {
    const batchNumber = requestedBatch === undefined ? '1' : requestedBatch;
    if (typeof batchNumber !== 'string'
      || !/^\d+$/.test(batchNumber)
      || !Number.isSafeInteger(Number(batchNumber))
      || Number(batchNumber) < 1) {
      return { kind: 'invalid', error: 'batch-number must be a positive integer.' };
    }

    try {
      const response = resource === 'stations'
        ? await gateway.getStations(batchNumber)
        : await gateway.getFuelPrices(batchNumber);
      return { kind: 'upstream', response };
    } catch {
      return { kind: 'failure' };
    }
  }

  return { getBatch };
}