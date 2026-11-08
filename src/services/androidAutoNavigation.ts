import { requireOptionalNativeModule } from 'expo';
import type { FuelStation } from '../domain/stations';
import type { SearchRadiusMiles } from './searchRadius';

type AndroidAutoNavigationModule = {
  showStations(
    stationsJson: string,
    anchorLatitude: number,
    anchorLongitude: number,
    hasCurrentLocation: boolean,
    radiusMiles: number,
  ): Promise<void>;
};

const androidAutoNavigation = requireOptionalNativeModule<AndroidAutoNavigationModule>(
  'AndroidAutoNavigation',
);

export function showAndroidAutoStations(
  stations: FuelStation[],
  anchor: { latitude: number; longitude: number },
  hasCurrentLocation: boolean,
  radiusMiles: SearchRadiusMiles,
): Promise<void> {
  if (!androidAutoNavigation) {
    return Promise.reject(
      new Error('Android Auto station map is unavailable. Rebuild the Android app and reconnect Android Auto.'),
    );
  }

  const stationsJson = JSON.stringify(stations.map((station) => ({
    name: station.name,
    details: station.prices.length > 0
      ? `${station.prices.map((price) => `${price.fuel} ${price.amount.toFixed(1)}p`).join(' | ')} · ${station.distanceMiles?.toFixed(1) ?? '?'} mi`
      : `No prices · ${station.distanceMiles?.toFixed(1) ?? '?'} mi`,
    latitude: station.latitude,
    longitude: station.longitude,
    distanceMiles: station.distanceMiles ?? 0,
  })));
  return androidAutoNavigation.showStations(
    stationsJson,
    anchor.latitude,
    anchor.longitude,
    hasCurrentLocation,
    radiusMiles,
  );
}
