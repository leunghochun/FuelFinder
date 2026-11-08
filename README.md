# Fuel Finder

An Expo and React Native app for viewing UK fuel stations on a map, checking prices, and sorting stations by distance.

## Run locally

The app gets nearby station results from the separate Node.js API server. Start that server from `api-server/` first and configure its Fuel Finder credentials in `api-server/.env`. Copy `.env.example` to `.env` for the app and set the server URL for your device or emulator. Restart Expo after editing `.env`:

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Use `http://localhost:3000` for the iOS simulator, `http://10.0.2.2:3000` for the Android emulator, or the API server computer's LAN IP for a physical device. Fuel Finder credentials remain server-side and are not configured in the RN app.

Allow location access to center the Leaflet map and sort by distance. The map uses OpenStreetMap tiles and needs an internet connection to display them; OpenStreetMap attribution is shown on the map. The embedded Leaflet map does not use Google Maps or require its API key. The app caches a successful response on the device and uses that saved data if a later request fails.

The map uses `react-native-leaflet-view` with Leaflet in a WebView and displays station markers individually rather than clustering them. When updating that package, refresh the bundled HTML file with `cp node_modules/react-native-leaflet-view/android/src/main/assets/leaflet.html assets/leaflet.html` and preserve the individual-marker behavior in the bundle. The native map is intended for iOS and Android; web map support is not configured.

## Android Auto

Android Auto uses `@iternio/react-native-auto-play` as a point-of-interest (POI) app. The station list uses POI-compatible templates so Android Auto can hand selected destinations to its configured navigation app instead of routing them back to Fuel Finder. Open Fuel Finder on the phone before connecting to Android Auto.

The Android Auto POI screen uses Android's native `PlaceListMapTemplate` to show a host-rendered map, station pins, and station details. Its title displays the selected search radius and the pins are filtered to that radius. The host-rendered POI map does not support drawing a radius circle. Selecting a station requests directions from the Android Auto host's configured navigation app. Up to six nearby stations are shown at a time. Station search uses the same service and saved search radius as the phone app; if location is unavailable, it uses the app's fallback region. Run `npx expo prebuild --platform android` and build with `npx expo run:android`. To test the car screen on Windows, install Android Auto on a phone and use Google's Desktop Head Unit (DHU) from the Android SDK.

## CarPlay Navigation

The iOS native project includes a Swift CarPlay navigation scene. It loads nearby stations from the configured API, previews a driving route with MapKit, and starts CarPlay guidance using the route's instructions. The installed `@iternio/react-native-auto-play` package can provide React Native car templates, but the CarPlay scene has not yet been migrated to it. Its current version requires Xcode 27 or later to build iOS. Launch Fuel Finder on the iPhone and grant location access before connecting CarPlay. Expo Go cannot run this integration.

Apple controls the `com.apple.developer.carplay-maps` entitlement. Request Apple's approval first, then set `FUEL_FINDER_ENABLE_CARPLAY_NAVIGATION_ENTITLEMENT=true` in the build environment and regenerate the iOS project with `npx expo prebuild --platform ios`. Do not enable the entitlement before Apple's approval because signing will fail without a matching provisioning profile. Entitlement approval and App Store acceptance are not guaranteed. See [Apple's entitlement request instructions](https://developer.apple.com/documentation/carplay/requesting-carplay-entitlements) and [navigation integration guide](https://developer.apple.com/documentation/carplay/integrating-carplay-with-your-navigation-app).
## Data flow

The app requests `/api/stations/search` with the device location, selected radius, sort mode, and selected products. The API server reads its cached station snapshot and returns normalized search results; the RN app caches the current query locally for offline fallback.

The API server handles Fuel Finder OAuth and batch pagination. The app sends its selected search parameters to the server and converts returned provider records into map stations in `src/domain/stations.ts`.

## Project scripts

- `npm start` starts Expo.
- `npm run android` starts Expo and opens the Android target.
- `npm run ios` starts Expo and opens the iOS target.
- `npm run web` starts Expo Web (native map functionality is not configured for web).
