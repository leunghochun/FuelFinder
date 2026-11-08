import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { LeafletView, MapShapeType, WebViewLeafletEvents } from 'react-native-leaflet-view';
import type { MapMarker, MapShape, WebviewLeafletMessage } from 'react-native-leaflet-view';
import { LocateFixed, MapPin, Navigation, RotateCw } from 'lucide-react-native';
import { FuelPrice, FuelStation } from './src/domain/stations';
import { getNavigationUrl, NavigationApp } from './src/services/navigation';
import {
  DEFAULT_SEARCH_RADIUS_MILES,
  loadSearchRadiusMiles,
  saveSearchRadiusMiles,
  SEARCH_RADIUS_OPTIONS,
  SearchRadiusMiles,
} from './src/services/searchRadius';
import { loadStations, StationLoadResult } from './src/services/stations';

const colors = {
  ink: '#17251F',
  muted: '#77827C',
  paper: '#F6F7F1',
  white: '#FFFFFF',
  green: '#176B4D',
  lime: '#D5F36A',
  line: '#E5E9E1',
  orange: '#E47B43',
};

type MapPoint = { lat: number; lng: number };

const initialRegion = {
  latitude: 54.2,
  longitude: -2.7,
};
function mapPoint(point: { latitude: number; longitude: number }): MapPoint {
  return { lat: point.latitude, lng: point.longitude };
}

function zoomForRadius(latitude: number, radiusMiles: number, mapHeight: number): number {
  const radiusMeters = radiusMiles * 1609.34;
  const metersPerPixel = (radiusMeters * 2) / mapHeight;
  const equatorialMetersPerPixel = 156543.03392 * Math.max(Math.cos(latitude * Math.PI / 180), 0.2);
  return Math.max(1, Math.min(19, Math.floor(Math.log2(equatorialMetersPerPixel / metersPerPixel))));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function stationMarkerIcon(label: string, isLowestPrice: boolean, selected: boolean): string {
  const markerColor = isLowestPrice ? colors.orange : selected ? colors.green : colors.ink;
  const labelColor = isLowestPrice ? colors.ink : colors.lime;
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;font-family:Arial,sans-serif">
    ${isLowestPrice ? `<span style="padding:2px 5px;border-radius:3px;background:${colors.orange};color:${colors.white};font-size:8px;font-weight:900">LOWEST</span>` : ''}
    <span style="max-width:100px;overflow:hidden;text-overflow:ellipsis;padding:3px 5px;border-radius:4px;background:${markerColor};color:${labelColor};font-size:9px;font-weight:800;white-space:nowrap">${escapeHtml(label)}</span>
    <span style="width:18px;height:18px;border:3px solid ${markerColor};border-radius:50%;background:${isLowestPrice ? '#FFF0E6' : selected ? colors.lime : colors.white}"></span>
  </div>`;
}

function bestPrice(prices: FuelPrice[]): FuelPrice | undefined {
  return prices.reduce<FuelPrice | undefined>((lowest, price) => {
    if (!lowest || price.amount < lowest.amount) return price;
    return lowest;
  }, undefined);
}

function bestPriceForProducts(prices: FuelPrice[], selectedProducts: Set<string>): FuelPrice | undefined {
  if (selectedProducts.size === 0) return bestPrice(prices);
  return prices.reduce<FuelPrice | undefined>((lowest, price) => {
    if (!selectedProducts.has(price.fuel.trim().toLocaleLowerCase())) return lowest;
    if (!lowest || price.amount < lowest.amount) return price;
    return lowest;
  }, undefined);
}

function formatPrice(price: FuelPrice | undefined): string {
  return price ? `${price.amount.toFixed(1)}p` : 'Price n/a';
}

function formatEffectiveTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return timestamp;
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function markerFuelName(fuel: string): string {
  const separatorIndex = fuel.indexOf('_');
  return separatorIndex === -1 ? fuel : fuel.slice(0, separatorIndex + 2);
}

function openMapApp(app: NavigationApp, station: FuelStation) {
  void Linking.openURL(getNavigationUrl(app, station)).catch(() => {
    Alert.alert('Unable to open maps', 'No compatible maps app could open this destination.');
  });
}

function StationRow({
  station,
  distance,
  selected,
  selectedProductKeys,
  onPress,
  onNavigate,
}: {
  station: FuelStation;
  distance?: number;
  selected: boolean;
  selectedProductKeys: Set<string>;
  onPress: () => void;
  onNavigate: () => void;
}) {
  const lowestPrice = bestPriceForProducts(station.prices, selectedProductKeys);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show ${station.name} on map`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.stationRow,
        selected && styles.stationRowSelected,
        pressed && styles.pressed,
      ]}
    >
      {selected ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Get directions to ${station.name}`}
          accessibilityHint="Choose a maps app to navigate to this station"
          hitSlop={8}
          onPress={onNavigate}
          style={({ pressed }) => [styles.brandMarkDirections, pressed && styles.pressed]}
        >
          <Navigation size={17} color={colors.white} />
        </Pressable>
      ) : (
        <View style={styles.brandMark}>
          <Text style={styles.brandInitial}>{station.brand.slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.stationMain}>
        <View style={styles.stationInfo}>
          <View style={styles.stationDetailsRow}>
            <Text numberOfLines={1} style={styles.stationName}>{station.name}</Text>
            <Text numberOfLines={1} style={styles.stationAddress}>{station.address || station.postcode || station.brand}</Text>
            <View style={styles.rowMeta}>
              <MapPin size={12} color={colors.green} />
              <Text style={styles.distanceText}>{distance === undefined ? 'Distance unavailable' : `${distance.toFixed(1)} mi away`}</Text>
            </View>
          </View>
        </View>
        {station.prices.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.priceList}
          >
            {station.prices.map((price, index) => (
              <View
                key={`${price.fuel}-${index}`}
                style={[styles.fuelPrice, price.amount === lowestPrice?.amount && styles.fuelPriceLowest]}
              >
                <View style={styles.fuelPriceHeader}>
                  <Text style={styles.fuelName}>{markerFuelName(price.fuel)}</Text>
                  <Text style={[styles.price, price.amount === lowestPrice?.amount && styles.lowestPrice]}>
                    {formatPrice(price)}
                  </Text>
                  {price.amount === lowestPrice?.amount ? <Text style={styles.lowestBadge}>LOWEST</Text> : null}
                </View>
                {price.priceChangeEffectiveTimestamp ? (
                  <Text style={styles.priceEffectiveTimestamp}>
                    Effective {formatEffectiveTimestamp(price.priceChangeEffectiveTimestamp)}
                  </Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : <Text style={styles.noPrice}>Prices unavailable</Text>}
      </View>
    </Pressable>
  );
}

export default function App() {
  const { height: windowHeight } = useWindowDimensions();
  const mapHeight = Math.min(520, Math.max(320, windowHeight * 0.6));
  const [stations, setStations] = useState<FuelStation[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string>();
  const [location, setLocation] = useState<{ latitude: number; longitude: number }>();
  const [mapCenterPosition, setMapCenterPosition] = useState<MapPoint>({
    lat: initialRegion.latitude,
    lng: initialRegion.longitude,
  });
  const [mapZoom, setMapZoom] = useState(6);
  const [leafletHtml, setLeafletHtml] = useState<string>();
  const [mapError, setMapError] = useState<string>();
  const locationRef = useRef<{ latitude: number; longitude: number } | undefined>(undefined);
  const stationRequestIdRef = useRef(0);
  const radiusMilesRef = useRef<SearchRadiusMiles>(DEFAULT_SEARCH_RADIUS_MILES);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [source, setSource] = useState<StationLoadResult['source']>();
  const [updatedAt, setUpdatedAt] = useState<string>();
  const [radiusMiles, setRadiusMiles] = useState<SearchRadiusMiles>(DEFAULT_SEARCH_RADIUS_MILES);
  const [sortMode, setSortMode] = useState<'distance' | 'price'>('distance');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [locationLoading, setLocationLoading] = useState(true);
  const [locationError, setLocationError] = useState<string>();

  const nearbyStations = stations;
  const selectedProductKeys = useMemo(() => new Set(selectedProducts), [selectedProducts]);
  const filteredNearbyStations = useMemo(
    () => selectedProductKeys.size === 0
      ? nearbyStations
      : nearbyStations.filter((station) => station.prices.some(
        (price) => selectedProductKeys.has(price.fuel.trim().toLocaleLowerCase()),
      )),
    [nearbyStations, selectedProductKeys],
  );
  const sortedNearbyStations = useMemo(() => {
    return [...filteredNearbyStations].sort((a, b) => {
      if (sortMode === 'distance') {
        return (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity);
      }
      const priceA = bestPriceForProducts(a.prices, selectedProductKeys)?.amount ?? Infinity;
      const priceB = bestPriceForProducts(b.prices, selectedProductKeys)?.amount ?? Infinity;
      return priceA - priceB || (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity);
    });
  }, [filteredNearbyStations, selectedProductKeys, sortMode]);
  const lowestNearbyPrice = filteredNearbyStations.reduce(
    (lowest, station) => Math.min(lowest, bestPriceForProducts(station.prices, selectedProductKeys)?.amount ?? Infinity),
    Infinity,
  );
  const mapMarkers = useMemo<MapMarker[]>(() => {
    const markers: MapMarker[] = location
      ? [{
        id: 'current-location',
        position: mapPoint(location),
        icon: '<div style="width:18px;height:18px;border:4px solid white;border-radius:50%;background:#4285F4;box-shadow:0 1px 5px #555"></div>',
        size: [18, 18],
        iconAnchor: [9, 9],
        title: 'Your location',
      }]
      : [];
    filteredNearbyStations.forEach((station) => {
      const price = bestPriceForProducts(station.prices, selectedProductKeys);
      const isLowestPrice = price?.amount === lowestNearbyPrice;
      const markerLabel = price
        ? `${markerFuelName(price.fuel)}: ${price.amount.toFixed(1)}`
        : 'No price';
      const priceDescription = station.prices.length > 0
        ? station.prices.map((fuelPrice) => `${fuelPrice.fuel}: ${formatPrice(fuelPrice)}`).join(' · ')
        : 'Prices unavailable';
      markers.push({
        id: station.id,
        position: { lat: station.latitude, lng: station.longitude },
        icon: stationMarkerIcon(markerLabel, isLowestPrice, selectedStationId === station.id),
        size: [110, 50],
        iconAnchor: [55, 50],
        title: `${station.name} · ${station.address || station.postcode || station.brand} · ${priceDescription}`,
      });
    });
    return markers;
  }, [filteredNearbyStations, location, lowestNearbyPrice, selectedProductKeys, selectedStationId]);
  const mapShapes = useMemo<MapShape[]>(
    () => location ? [{
      id: 'search-radius',
      shapeType: MapShapeType.CIRCLE,
      center: mapPoint(location),
      radius: radiusMiles * 1609.34,
      color: colors.green,
    }] : [],
    [location, radiusMiles],
  );
  const distinctProducts = useMemo(() => {
    const products = new Map<string, string>();
    stations.forEach((station) => {
      station.prices.forEach((price) => {
        const product = price.fuel.trim();
        if (product) products.set(product.toLocaleLowerCase(), product);
      });
    });
    selectedProducts.forEach((product) => {
      if (!products.has(product)) products.set(product, product.toUpperCase());
    });
    return Array.from(products.values()).sort((a, b) => a.localeCompare(b));
  }, [stations, selectedProducts]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const asset = Asset.fromModule(require('./assets/leaflet.html'));
        await asset.downloadAsync();
        if (!asset.localUri) throw new Error('Leaflet map asset could not be loaded.');
        const html = await new File(asset.localUri).text();
        if (active) setLeafletHtml(html);
      } catch (loadError) {
        if (active) {
          setMapError(loadError instanceof Error ? loadError.message : 'Leaflet map could not be loaded.');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function toggleProductFilter(product: string) {
    const productKey = product.trim().toLocaleLowerCase();
    const nextProducts = selectedProducts.includes(productKey)
      ? selectedProducts.filter((selected) => selected !== productKey)
      : [...selectedProducts, productKey];
    setSelectedProducts(nextProducts);
    void refreshStations(true, locationRef.current ?? initialRegion, radiusMilesRef.current, sortMode, nextProducts);
  }

  async function updateLocation(): Promise<{ latitude: number; longitude: number } | undefined> {
    setLocationLoading(true);
    setLocationError(undefined);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setLocationError('Allow location access to show stations near you.');
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const point = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      locationRef.current = point;
      setLocation(point);
      setMapCenterPosition(mapPoint(point));
      setMapZoom(zoomForRadius(point.latitude, radiusMilesRef.current, mapHeight));
      return point;
    } catch (locationFailure) {
      setLocationError(
        locationFailure instanceof Error
          ? `Could not get your location: ${locationFailure.message}`
          : 'Could not get your location. Check permissions and device location services.',
      );
    } finally {
      setLocationLoading(false);
    }
  }

  async function refreshStations(
    showSpinner = true,
    searchPoint = locationRef.current ?? initialRegion,
    searchRadius = radiusMilesRef.current,
    requestedSortMode = sortMode,
    products = selectedProducts,
  ) {
    const requestId = stationRequestIdRef.current + 1;
    stationRequestIdRef.current = requestId;
    if (showSpinner) setRefreshing(true);
    setError(undefined);
    try {
      const result = await loadStations({
        latitude: searchPoint.latitude,
        longitude: searchPoint.longitude,
        miles: searchRadius,
        sort: requestedSortMode === 'price' ? 'lowest-price' : 'closest',
        products,
        limit: 20,
      });
      if (requestId !== stationRequestIdRef.current) return;
      setStations(result.stations);
      setSource(result.source);
      setUpdatedAt(result.updatedAt);
      if (result.source === 'cache' && result.refreshError) {
        setError(`Station refresh failed: ${result.refreshError}`);
      } else if (result.cacheError) {
        setError(`Fresh station data loaded but could not be saved: ${result.cacheError}`);
      }
      if (locationRef.current) {
        setMapCenterPosition(mapPoint(locationRef.current));
        setMapZoom(zoomForRadius(locationRef.current.latitude, radiusMilesRef.current, mapHeight));
      } else if (result.source === 'network' && result.stations[0]) {
        setMapCenterPosition(mapPoint(result.stations[0]));
        setMapZoom(12);
      }
    } catch (loadError) {
      if (requestId === stationRequestIdRef.current) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load station data.');
      }
    } finally {
      if (requestId === stationRequestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      let initialRadius = DEFAULT_SEARCH_RADIUS_MILES;
      try {
        initialRadius = await loadSearchRadiusMiles();
      } catch (preferenceError) {
        console.error('Could not restore the saved station search radius.', preferenceError);
        if (active) setError('Could not restore the saved search radius; using 5 miles.');
      }
      if (!active) return;
      radiusMilesRef.current = initialRadius;
      setRadiusMiles(initialRadius);

      const point = await updateLocation();
      if (active) void refreshStations(false, point ?? initialRegion, initialRadius);
    })();
    return () => {
      active = false;
      stationRequestIdRef.current += 1;
    };
  }, []);

  function selectRadius(radius: SearchRadiusMiles) {
    radiusMilesRef.current = radius;
    setRadiusMiles(radius);
    void saveSearchRadiusMiles(radius).catch((preferenceError: unknown) => {
      console.error('Could not save the selected station search radius.', preferenceError);
      setError('Could not save the selected search radius.');
    });
    if (location) {
      setMapCenterPosition(mapPoint(location));
      setMapZoom(zoomForRadius(location.latitude, radius, mapHeight));
    }
    void refreshStations(true, locationRef.current ?? initialRegion, radius);
  }

  function selectSortMode(mode: 'distance' | 'price') {
    setSortMode(mode);
    void refreshStations(true, locationRef.current ?? initialRegion, radiusMilesRef.current, mode, selectedProducts);
  }

  function focusStation(station: FuelStation) {
    setSelectedStationId(station.id);
    setMapCenterPosition(mapPoint(station));
    setMapZoom(14);
  }

  function handleMapMessage(message: WebviewLeafletMessage) {
    if (message.error) {
      setMapError(message.error);
      return;
    }
    if (message.event !== WebViewLeafletEvents.ON_MAP_MARKER_CLICKED) return;
    const stationId = message.payload?.mapMarkerID;
    if (!stationId || stationId === 'current-location') return;
    const station = filteredNearbyStations.find((item) => item.id === stationId);
    if (!station) return;
    setSelectedStationId(station.id);
    console.log('[Fuel Finder] Station selected:', {
      loadedFrom: source ?? 'unknown',
      station: { ...station, sourceData: station.sourceData ?? null },
      priceApiData: station.priceSourceData ?? null,
      prices: station.prices,
    });
  }

  function chooseDirectionsApp(station: FuelStation) {
    const googleMaps = { text: 'Google Maps', onPress: () => openMapApp('google', station) };
    const waze = { text: 'Waze', onPress: () => openMapApp('waze', station) };
    const cancel = { text: 'Cancel', style: 'cancel' as const };

    if (Platform.OS === 'ios') {
      Alert.alert('Get directions', station.name, [
        googleMaps,
        waze,
        { text: 'Apple Maps', onPress: () => openMapApp('apple', station) },
        cancel,
      ]);
      return;
    }

    Alert.alert('Get directions', station.name, [googleMaps, waze, cancel]);
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.eyebrow}>UK FUEL PRICES</Text>
          {distinctProducts.length > 0 || selectedProductKeys.size > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productTags}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Show all fuel products"
                accessibilityState={{ selected: selectedProductKeys.size === 0 }}
                onPress={() => {
                  setSelectedProducts([]);
                  void refreshStations(true, locationRef.current ?? initialRegion, radiusMilesRef.current, sortMode, []);
                }}
                style={[styles.productTag, selectedProductKeys.size === 0 && styles.productTagSelected]}
              >
                <Text style={[styles.productTagText, selectedProductKeys.size === 0 && styles.productTagTextSelected]}>ALL</Text>
              </Pressable>
              {distinctProducts.map((product) => (
                <Pressable
                  key={product.toLocaleLowerCase()}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter by ${product}`}
                  accessibilityState={{ selected: selectedProductKeys.has(product.toLocaleLowerCase()) }}
                  onPress={() => toggleProductFilter(product)}
                  style={[styles.productTag, selectedProductKeys.has(product.toLocaleLowerCase()) && styles.productTagSelected]}
                >
                  <Text numberOfLines={1} style={[styles.productTagText, selectedProductKeys.has(product.toLocaleLowerCase()) && styles.productTagTextSelected]}>{markerFuelName(product)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel="Refresh station data"
          onPress={() => void refreshStations()}
          style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
        >
          {refreshing ? <ActivityIndicator size="small" color={colors.ink} /> : <RotateCw size={18} color={colors.ink} />}
        </Pressable>
      </View>

      <View style={styles.radiusRow}>
        <Text style={styles.radiusLabel}>RADIUS</Text>
        <View style={styles.radiusOptions}>
          {SEARCH_RADIUS_OPTIONS.map((radius) => (
            <Pressable
              key={radius}
              accessibilityRole="button"
              accessibilityLabel={`Show stations within ${radius} miles`}
              accessibilityState={{ selected: radiusMiles === radius }}
              onPress={() => selectRadius(radius)}
              style={[styles.radiusOption, radiusMiles === radius && styles.radiusOptionSelected]}
            >
              <Text style={[styles.radiusOptionText, radiusMiles === radius && styles.radiusOptionTextSelected]}>
                {radius} mi
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.radiusStatus}>
          <View style={styles.liveDot} />
          <Text numberOfLines={1} style={styles.radiusStatusText}>
            {location ? `${filteredNearbyStations.length} nearby` : 'Locating'}
          </Text>
        </View>
      </View>

      <View style={[styles.mapFrame, { height: mapHeight }]}>
        {leafletHtml ? (
          <LeafletView
            source={{ html: leafletHtml }}
            mapCenterPosition={mapCenterPosition}
            zoom={mapZoom}
            mapMarkers={mapMarkers}
            mapShapes={mapShapes}
            onMessageReceived={handleMapMessage}
            onError={(event) => setMapError(event.nativeEvent.description || 'Leaflet map could not be loaded.')}
            zoomControl={false}
            attributionControl
            doDebug={false}
          />
        ) : (
          <View style={styles.mapLoading}>
            {mapError ? (
              <Text style={styles.mapErrorText}>{mapError}</Text>
            ) : (
              <>
                <ActivityIndicator color={colors.green} />
                <Text style={styles.mapLoadingText}>Loading map…</Text>
              </>
            )}
          </View>
        )}
        {leafletHtml && mapError ? (
          <View style={styles.mapError}>
            <Text style={styles.mapErrorText}>{mapError}</Text>
          </View>
        ) : null}
        <Pressable
          accessibilityLabel="Find my location"
          onPress={() => {
            void updateLocation().then((point) => {
              void refreshStations(true, point ?? locationRef.current ?? initialRegion);
            });
          }}
          style={({ pressed }) => [styles.locateButton, pressed && styles.pressed]}
        >
          <LocateFixed size={19} color={colors.ink} />
        </Pressable>
        {source ? (
          <View style={styles.mapCaption}>
            <Text style={styles.mapCaptionText}>{source === 'cache' ? 'SAVED DATA' : 'LIVE DATA'}</Text>
          </View>
        ) : null}
      </View>
      {locationError ? <Text style={styles.locationError}>{locationError}</Text> : null}

      <View style={styles.listHeader}>
        <View>
          <Text style={styles.sectionTitle}>Nearby stations</Text>
          <Text style={styles.sectionSubtitle}>
            {updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Fuel prices and distances'}
          </Text>
        </View>
        <View style={styles.sortControl}>
          {([
            ['distance', 'Closest'],
            ['price', 'Lowest price'],
          ] as const).map(([mode, label]) => (
            <Pressable
              key={mode}
              accessibilityRole="button"
              accessibilityLabel={`Sort nearby stations by ${label.toLowerCase()}`}
              accessibilityState={{ selected: sortMode === mode }}
              onPress={() => selectSortMode(mode)}
              style={[styles.sortOption, sortMode === mode && styles.sortOptionSelected]}
            >
              <Text style={[styles.sortOptionText, sortMode === mode && styles.sortOptionTextSelected]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {error && stations.length > 0 ? (
        <Text style={styles.inlineError}>
          {error}{source === 'cache' ? ' Showing saved data.' : ''}
        </Text>
      ) : null}

      {locationLoading && stations.length === 0 ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={colors.green} />
          <Text style={styles.emptyText}>Finding your location…</Text>
        </View>
      ) : loading && stations.length === 0 ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={colors.green} />
          <Text style={styles.emptyText}>Loading station data in the background…</Text>
        </View>
      ) : sortedNearbyStations.length > 0 ? (
        <FlatList
          data={sortedNearbyStations}
          keyExtractor={(station) => station.id}
          renderItem={({ item }) => (
            <StationRow
              station={item}
              distance={item.distanceMiles}
              selected={selectedStationId === item.id}
              selectedProductKeys={selectedProductKeys}
              onPress={() => focusStation(item)}
              onNavigate={() => chooseDirectionsApp(item)}
            />
          )}
          contentContainerStyle={styles.stationList}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{error ? 'Stations unavailable' : location && selectedProductKeys.size > 0 ? 'No nearby stations match' : location ? `No stations within ${radiusMiles} miles` : 'Location unavailable'}</Text>
          <Text style={styles.emptyText}>{error || (location && selectedProductKeys.size > 0 ? 'Try another fuel product or select ALL.' : location ? 'Try a wider search radius.' : 'Enable location access to find nearby fuel stations.')}</Text>
          {error ? (
            <Pressable onPress={() => void refreshStations()} style={styles.retryButton}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 6, paddingBottom: 6 },
  headerTitleRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  eyebrow: { color: colors.green, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  productTags: { alignItems: 'center', gap: 4, paddingRight: 4 },
  productTag: { maxWidth: 100, paddingHorizontal: 5, paddingVertical: 3, borderRadius: 3, backgroundColor: '#E8EDE5' },
  productTagSelected: { backgroundColor: colors.green },
  productTagText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  productTagTextSelected: { color: colors.white },
  title: { color: colors.ink, fontSize: 26, fontWeight: '800', marginTop: 3 },
  refreshButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.lime },
  pressed: { opacity: 0.7 },
  summaryBar: { height: 34, marginHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.line },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.orange },
  summaryText: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8, flex: 1 },
  summaryCount: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  radiusRow: { minHeight: 42, marginHorizontal: 14, paddingHorizontal: 8, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 7 },
  radiusLabel: { color: colors.ink, fontSize: 9, fontWeight: '800' },
  radiusStatus: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  radiusStatusText: { color: colors.muted, fontSize: 9, fontWeight: '600' },
  radiusOptions: { flex: 1, flexDirection: 'row', gap: 3, padding: 3, borderRadius: 4, backgroundColor: '#E8EDE5' },
  radiusOption: { flex: 1, minWidth: 0, height: 25, paddingHorizontal: 5, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  radiusOptionSelected: { backgroundColor: colors.green },
  radiusOptionText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  radiusOptionTextSelected: { color: colors.white },
  mapFrame: { position: 'relative', marginHorizontal: 14, overflow: 'hidden', borderRadius: 5, backgroundColor: '#DCE6DC' },
  mapLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  mapLoadingText: { color: colors.muted, fontSize: 11 },
  mapError: { position: 'absolute', top: 12, left: 12, right: 12, padding: 10, borderRadius: 4, backgroundColor: colors.white },
  mapErrorText: { color: '#A64A31', fontSize: 11, textAlign: 'center' },
  locateButton: { position: 'absolute', right: 12, bottom: 42, width: 42, height: 42, borderRadius: 4, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  mapCaption: { position: 'absolute', bottom: 10, left: 10, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: colors.white, borderRadius: 3 },
  mapCaptionText: { color: colors.green, fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  locationError: { color: '#A64A31', fontSize: 11, paddingHorizontal: 22, paddingTop: 6 },
  listHeader: { paddingHorizontal: 22, paddingTop: 5, paddingBottom: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  sectionSubtitle: { color: colors.muted, fontSize: 11, marginTop: 3 },
  sortControl: { flexDirection: 'row', padding: 2, borderRadius: 4, backgroundColor: '#E8EDE5' },
  sortOption: { minHeight: 30, paddingHorizontal: 8, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  sortOptionSelected: { backgroundColor: colors.green },
  sortOptionText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  sortOptionTextSelected: { color: colors.white },
  inlineError: { color: '#A64A31', fontSize: 11, paddingHorizontal: 22, paddingBottom: 8 },
  stationList: { paddingHorizontal: 22, paddingBottom: 16 },
  stationRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  stationRowSelected: { backgroundColor: '#EFF6D0' },
  stationMain: { flex: 1, minWidth: 0 },
  brandMark: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#E8EDE5', alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  brandMarkDirections: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  brandInitial: { color: colors.green, fontSize: 14, fontWeight: '800' },
  stationInfo: { minWidth: 0 },
  stationDetailsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stationName: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 11, fontWeight: '700' },
  stationAddress: { flex: 1, minWidth: 0, color: colors.muted, fontSize: 9 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 0 },
  distanceText: { color: colors.muted, fontSize: 9 },
  priceList: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingRight: 8, marginTop: 4 },
  fuelPrice: { alignItems: 'flex-start', gap: 2, paddingHorizontal: 4, paddingVertical: 3, borderRadius: 3, backgroundColor: '#EEF1EA' },
  fuelPriceHeader: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  fuelPriceLowest: { backgroundColor: '#EFF6D0' },
  fuelName: { color: colors.green, fontSize: 9, fontWeight: '700' },
  price: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  priceEffectiveTimestamp: { color: colors.muted, fontSize: 7 },
  lowestPrice: { color: colors.green },
  lowestBadge: { color: colors.green, fontSize: 6, fontWeight: '900' },
  noPrice: { color: colors.muted, fontSize: 9, marginTop: 3 },
  separator: { height: 1, backgroundColor: colors.line },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 35, gap: 9 },
  emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  emptyText: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  retryButton: { marginTop: 6, backgroundColor: colors.green, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 4 },
  retryText: { color: colors.white, fontSize: 12, fontWeight: '700' },
});
