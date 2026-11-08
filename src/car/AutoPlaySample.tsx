import {
  HybridAutoPlay,
} from '@iternio/react-native-auto-play';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { stationsWithinRadius } from '../domain/stations';
import { showAndroidAutoStations } from '../services/androidAutoNavigation';
import {
  DEFAULT_SEARCH_RADIUS_MILES,
  loadSearchRadiusMiles,
  type SearchRadiusMiles,
} from '../services/searchRadius';
import { loadStations } from '../services/stations';

const initialRegion = { latitude: 54.2, longitude: -2.7 };
let registered = false;

export function registerAutoPlaySample() {
  if (Platform.OS !== 'android' || registered) return;

  registered = true;
  HybridAutoPlay.addListener('didConnect', (sessionId) => {
    let radiusMiles = DEFAULT_SEARCH_RADIUS_MILES;
    let searchCenter = initialRegion;
    let hasCurrentLocation = false;

    void (async () => {
      try {
        radiusMiles = await loadSearchRadiusMiles();
      } catch (error) {
        console.error('Could not load the selected station search radius.', error);
      }
      if (HybridAutoPlay.getCurrentSessionId() !== sessionId) return;

      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.granted) {
        try {
          const current = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          searchCenter = {
            latitude: current.coords.latitude,
            longitude: current.coords.longitude,
          };
          hasCurrentLocation = true;
        } catch (error) {
          console.warn('Could not get the current location for Android Auto; using the app fallback region.', error);
        }
      }

      const result = await loadStations({
        ...searchCenter,
        miles: radiusMiles,
        sort: 'closest',
        products: [],
        limit: 20,
      });

      if (HybridAutoPlay.getCurrentSessionId() !== sessionId) return;

      const nearbyStations = stationsWithinRadius(
        result.stations,
        searchCenter,
        radiusMiles,
      );
      await showAndroidAutoStations(
        nearbyStations,
        searchCenter,
        hasCurrentLocation,
        radiusMiles,
      );
    })().catch((error: unknown) => {
      console.error('Could not initialize the Android Auto POI map.', error);
    });
  });
}
