import type { FuelStation } from '../domain/stations';

export type NavigationApp = 'google' | 'waze' | 'apple';

export function getAndroidAutoNavigationUrl(app: 'google' | 'waze', station: FuelStation): string {
  if (app === 'google') {
    return `google.navigation:q=${station.latitude},${station.longitude}`;
  }
  return getNavigationUrl(app, station);
}

export function getNavigationUrl(app: NavigationApp, station: FuelStation): string {
  const destination = `${station.latitude},${station.longitude}`;
  const urls: Record<NavigationApp, string> = {
    google: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`,
    waze: `https://waze.com/ul?ll=${encodeURIComponent(destination)}&navigate=yes`,
    apple: `http://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=d`,
  };
  return urls[app];
}
