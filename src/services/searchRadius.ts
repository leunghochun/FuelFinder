import AsyncStorage from '@react-native-async-storage/async-storage';

export const SEARCH_RADIUS_OPTIONS = [1, 5, 10, 20] as const;
export type SearchRadiusMiles = (typeof SEARCH_RADIUS_OPTIONS)[number];
export const DEFAULT_SEARCH_RADIUS_MILES: SearchRadiusMiles = 5;

const SEARCH_RADIUS_KEY = 'fuel-finder.search-radius.v1';

function isSearchRadiusMiles(radius: number): radius is SearchRadiusMiles {
  return SEARCH_RADIUS_OPTIONS.some((option) => option === radius);
}

export async function loadSearchRadiusMiles(): Promise<SearchRadiusMiles> {
  const savedRadius = await AsyncStorage.getItem(SEARCH_RADIUS_KEY);
  if (savedRadius === null) return DEFAULT_SEARCH_RADIUS_MILES;

  const radius = Number(savedRadius);
  if (isSearchRadiusMiles(radius)) return radius;
  throw new Error(`Saved search radius is invalid: ${savedRadius}`);
}

export async function saveSearchRadiusMiles(radius: SearchRadiusMiles): Promise<void> {
  if (!SEARCH_RADIUS_OPTIONS.includes(radius)) {
    throw new Error(`Unsupported search radius: ${radius}`);
  }
  await AsyncStorage.setItem(SEARCH_RADIUS_KEY, String(radius));
}
