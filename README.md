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

Allow location access to center the map and sort by distance. The app caches a successful response on the device and uses that saved data if a later request fails.

For a standalone Android build, configure a Google Maps API key as described by the `react-native-maps` Expo documentation. The map is intended for native iOS and Android; web map support is not configured.

## Android Auto

Android builds include an Android Auto point-of-interest screen for nearby fuel stations. It uses the phone's last-known location, shows fuel prices and distance, and opens a selected station in Google Maps. Open Fuel Finder on the phone and grant location access before connecting to Android Auto. Configure the API server URL in `.env`; local HTTP is enabled for development URLs, while release builds should use HTTPS.

Run `npx expo prebuild --platform android` and build with `npx expo run:android`. To test the car screen on Windows, install Android Auto on a phone and use Google's Desktop Head Unit (DHU) from the Android SDK. Release builds must replace the generated `fuel_finder_car_host_signatures` string array with the approved host certificate digest/package pairs.

## CarPlay Navigation

The iOS native project includes a CarPlay navigation scene. It loads nearby stations from the configured API, previews a driving route with MapKit, and starts CarPlay guidance using the route's instructions. Launch Fuel Finder on the iPhone and grant location access before connecting CarPlay. The iOS app must be built from macOS with Xcode; Expo Go cannot run this integration.

Apple controls the `com.apple.developer.carplay-maps` entitlement. Request Apple's approval first, then set `FUEL_FINDER_ENABLE_CARPLAY_NAVIGATION_ENTITLEMENT=true` in the build environment and regenerate the iOS project with `npx expo prebuild --platform ios`. Do not enable the entitlement before Apple's approval because signing will fail without a matching provisioning profile. Entitlement approval and App Store acceptance are not guaranteed. See [Apple's entitlement request instructions](https://developer.apple.com/documentation/carplay/requesting-carplay-entitlements) and [navigation integration guide](https://developer.apple.com/documentation/carplay/integrating-carplay-with-your-navigation-app).
## Data flow

The app requests `/api/stations/search` with the device location, selected radius, sort mode, and selected products. The API server reads its cached station snapshot and returns normalized search results; the RN app caches the current query locally for offline fallback.

The API server handles Fuel Finder OAuth and batch pagination. The app sends its selected search parameters to the server and converts returned provider records into map stations in `src/domain/stations.ts`.

## Project scripts

- `npm start` starts Expo.
- `npm run android` starts Expo and opens the Android target.
- `npm run ios` starts Expo and opens the iOS target.
- `npm run web` starts Expo Web (native map functionality is not configured for web).
