const {
  withAndroidManifest,
  withGradleProperties,
  withProjectBuildGradle,
} = require('@expo/config-plugins');

function addPermission(manifest, name) {
  manifest.manifest['uses-permission'] ??= [];
  if (!manifest.manifest['uses-permission'].some((entry) => entry.$['android:name'] === name)) {
    manifest.manifest['uses-permission'].push({ $: { 'android:name': name } });
  }
}

function withFuelFinderAndroidAuto(config) {
  config = withGradleProperties(config, (modConfig) => {
    const categoryProperty = modConfig.modResults.find(
      (property) => property.type === 'property' && property.key === 'ReactNativeAutoPlay_androidAutoAppCategory',
    );
    if (categoryProperty) categoryProperty.value = 'poi';
    else {
      modConfig.modResults.push({
        type: 'property',
        key: 'ReactNativeAutoPlay_androidAutoAppCategory',
        value: 'poi',
      });
    }
    return modConfig;
  });

  config = withProjectBuildGradle(config, (modConfig) => {
    const contents = modConfig.modResults.contents;
    const categoryOverride = "ext.androidAutoAppCategory = 'poi'";
    if (!contents.includes(categoryOverride)) {
      const allProjectsStart = contents.indexOf('allprojects {');
      if (allProjectsStart === -1) {
        throw new Error('Could not configure the Auto Play app category in android/build.gradle.');
      }
      modConfig.modResults.contents =
        `${contents.slice(0, allProjectsStart)}${categoryOverride}\n\n${contents.slice(allProjectsStart)}`;
    }
    return modConfig;
  });

  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults;
    const application = manifest.manifest.application[0];
    const apiBaseUrl = process.env.EXPO_PUBLIC_FUEL_FINDER_API_BASE_URL || 'http://localhost:3000';
    addPermission(manifest, 'android.permission.ACCESS_COARSE_LOCATION');
    addPermission(manifest, 'android.permission.ACCESS_FINE_LOCATION');
    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'].filter(
      (permission) => ![
        'androidx.car.app.NAVIGATION_TEMPLATES',
        'androidx.car.app.ACCESS_SURFACE',
      ].includes(permission.$['android:name']),
    );
    addPermission(manifest, 'androidx.car.app.MAP_TEMPLATES');
    if (apiBaseUrl.startsWith('http://')) application.$['android:usesCleartextTraffic'] = 'true';

    manifest.manifest['uses-feature'] ??= [];
    if (!manifest.manifest['uses-feature'].some((entry) => entry.$['android:name'] === 'android.software.car.templates')) {
      manifest.manifest['uses-feature'].push({
        $: { 'android:name': 'android.software.car.templates', 'android:required': 'false' },
      });
    }

    return modConfig;
  });

  return config;
}

module.exports = withFuelFinderAndroidAuto;