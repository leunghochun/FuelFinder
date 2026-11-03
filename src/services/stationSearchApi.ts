export type StationSearchRequest = {
  latitude: number;
  longitude: number;
  miles: number;
  sort: 'closest' | 'lowest-price';
  products: string[];
  limit: number;
};

export type StationSearchResponse = {
  stations: unknown[];
  total: number;
  limit: number;
  updatedAt?: string;
};

export function createStationSearchClient(baseUrl: string, fetchImpl: typeof fetch = fetch) {
  async function search(request: StationSearchRequest): Promise<StationSearchResponse> {
    const url = new URL('/api/stations/search', `${baseUrl.replace(/\/+$/, '')}/`);
    url.searchParams.set('latitude', String(request.latitude));
    url.searchParams.set('longitude', String(request.longitude));
    url.searchParams.set('miles', String(request.miles));
    url.searchParams.set('sort', request.sort);
    url.searchParams.set('limit', String(request.limit));
    if (request.products.length > 0) url.searchParams.set('product', request.products.join(','));

    const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    let payload: unknown;
    try {
      payload = await response.json() as unknown;
    } catch {
      throw new Error(`Station search returned invalid JSON (${response.status}).`);
    }

    if (!response.ok) {
      const error = payload !== null && typeof payload === 'object'
        ? (payload as Record<string, unknown>).error
        : undefined;
      throw new Error(typeof error === 'string' ? error : `Station search failed (${response.status}).`);
    }
    if (payload === null || typeof payload !== 'object'
      || !Array.isArray((payload as Record<string, unknown>).stations)) {
      throw new Error('Station search response did not contain a station array.');
    }

    return payload as StationSearchResponse;
  }

  return { search };
}

const apiBaseUrl = process.env.EXPO_PUBLIC_FUEL_FINDER_API_BASE_URL || 'http://localhost:3000';
const stationSearchClient = createStationSearchClient(apiBaseUrl);

export function searchFuelStations(request: StationSearchRequest): Promise<StationSearchResponse> {
  return stationSearchClient.search(request);
}