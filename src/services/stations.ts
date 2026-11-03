import AsyncStorage from '@react-native-async-storage/async-storage';
import { FuelStation, normalizeStations } from '../domain/stations';
import { searchFuelStations, type StationSearchRequest } from './stationSearchApi';

const CACHE_KEY = 'fuel-finder.station-search.v1';

type StationCache = {
  stations: Array<Omit<FuelStation, 'sourceData' | 'priceSourceData'>>;
  updatedAt: string;
  queryKey: string;
};

export type StationLoadResult = StationCache & {
  stations: FuelStation[];
  source: 'network' | 'cache';
  refreshError?: string;
  cacheError?: string;
};

export function createStationCacheSnapshot(stations: FuelStation[], updatedAt: string, queryKey: string): StationCache {
  return {
    stations: stations.map(({ id, name, brand, address, postcode, latitude, longitude, prices, distanceMiles }) => ({
      id,
      name,
      brand,
      address,
      postcode,
      latitude,
      longitude,
      prices,
      distanceMiles,
    })),
    updatedAt,
    queryKey,
  };
}

async function readCache(queryKey: string): Promise<StationCache | undefined> {
  const cached = await AsyncStorage.getItem(CACHE_KEY);
  if (!cached) return undefined;
  try {
    const value = JSON.parse(cached) as StationCache;
    if (Array.isArray(value.stations) && typeof value.updatedAt === 'string' && value.queryKey === queryKey) return value;
  } catch {
    await AsyncStorage.removeItem(CACHE_KEY);
  }
  return undefined;
}

export async function loadStations(request: StationSearchRequest): Promise<StationLoadResult> {
  const queryKey = JSON.stringify({ ...request, products: [...request.products].sort() });
  const cache = await readCache(queryKey);
  try {
    console.info('[Fuel Finder API] Searching stations', {
      latitude: request.latitude,
      longitude: request.longitude,
      miles: request.miles,
      sort: request.sort,
      products: request.products,
      limit: request.limit,
    });
    const response = await searchFuelStations(request);
    const stations = normalizeStations(response.stations);
    if (response.stations.length > 0 && stations.length === 0) {
      throw new Error('The station search response contained no usable station coordinates.');
    }
    const cacheSnapshot = createStationCacheSnapshot(
      stations,
      response.updatedAt || new Date().toISOString(),
      queryKey,
    );
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cacheSnapshot));
      return { ...cacheSnapshot, stations, source: 'network' };
    } catch (error) {
      return {
        ...cacheSnapshot,
        stations,
        source: 'network',
        cacheError: error instanceof Error ? error.message : 'Unknown storage error.',
      };
    }
  } catch (error) {
    if (cache) {
      return {
        ...cache,
        source: 'cache',
        refreshError: error instanceof Error ? error.message : 'Unknown network error.',
      };
    }
    throw error;
  }
}

