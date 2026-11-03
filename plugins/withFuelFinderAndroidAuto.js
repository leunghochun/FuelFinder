const fs = require('node:fs/promises');
const path = require('node:path');
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} = require('@expo/config-plugins');

const carAppDependency = 'androidx.car.app:app:1.7.0';

function addPermission(manifest, name) {
  manifest.manifest['uses-permission'] ??= [];
  if (!manifest.manifest['uses-permission'].some((entry) => entry.$['android:name'] === name)) {
    manifest.manifest['uses-permission'].push({ $: { 'android:name': name } });
  }
}

function addMetadata(application, name, value, resource = false) {
  application['meta-data'] ??= [];
  const existing = application['meta-data'].find((entry) => entry.$['android:name'] === name);
  const attributes = { 'android:name': name, [resource ? 'android:resource' : 'android:value']: value };
  if (existing) existing.$ = { ...existing.$, ...attributes };
  else application['meta-data'].push({ $: attributes });
}

function withFuelFinderAndroidAuto(config) {
  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults;
    const application = manifest.manifest.application[0];
    const appPackage = config.android.package || config.android.applicationId;
    const apiBaseUrl = process.env.EXPO_PUBLIC_FUEL_FINDER_API_BASE_URL || 'http://localhost:3000';

    addPermission(manifest, 'androidx.car.app.MAP_TEMPLATES');
    addPermission(manifest, 'android.permission.ACCESS_COARSE_LOCATION');
    addPermission(manifest, 'android.permission.ACCESS_FINE_LOCATION');
    if (apiBaseUrl.startsWith('http://')) application.$['android:usesCleartextTraffic'] = 'true';

    manifest.manifest['uses-feature'] ??= [];
    if (!manifest.manifest['uses-feature'].some((entry) => entry.$['android:name'] === 'android.software.car.templates')) {
      manifest.manifest['uses-feature'].push({
        $: { 'android:name': 'android.software.car.templates', 'android:required': 'false' },
      });
    }

    application.service ??= [];
    if (!application.service.some((entry) => entry.$['android:name'] === '.car.FuelFinderCarAppService')) {
      application.service.push({
        $: {
          'android:name': '.car.FuelFinderCarAppService',
          'android:exported': 'true',
          'android:label': config.name || 'Fuel Finder',
        },
        'intent-filter': [{
          action: [{ $: { 'android:name': 'androidx.car.app.CarAppService' } }],
          category: [{ $: { 'android:name': 'androidx.car.app.category.POI' } }],
        }],
      });
    }

    addMetadata(application, 'androidx.car.app.minCarApiLevel', '5');
    addMetadata(application, 'com.google.android.gms.car.application', '@xml/automotive_app_desc', true);
    addMetadata(application, 'com.fuelfinder.API_BASE_URL', apiBaseUrl);
    return modConfig;
  });

  config = withAppBuildGradle(config, (modConfig) => {
    const contents = modConfig.modResults.contents;
    if (!contents.includes(carAppDependency)) {
      modConfig.modResults.contents = contents.replace(
        /dependencies\s*\{/,
        (block) => `${block}\n    implementation("${carAppDependency}")`,
      );
    }
    return modConfig;
  });

  return withDangerousMod(config, ['android', async (modConfig) => {
    const projectRoot = modConfig.modRequest.projectRoot;
    const androidRoot = modConfig.modRequest.platformProjectRoot;
    const appPackage = config.android.package || config.android.applicationId;
    if (!appPackage) throw new Error('Set expo.android.package before generating Android Auto files.');
    const packagePath = appPackage.replaceAll('.', path.sep);
    const sourcePath = path.join(projectRoot, 'plugins', 'android-auto', 'FuelFinderCarAppService.kt');
    const targetPath = path.join(androidRoot, 'app', 'src', 'main', 'java', packagePath, 'car', 'FuelFinderCarAppService.kt');
    const resourcePath = path.join(androidRoot, 'app', 'src', 'main', 'res', 'xml');
    const valuesPath = path.join(androidRoot, 'app', 'src', 'main', 'res', 'values');
    const source = await fs.readFile(sourcePath, 'utf8');

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, source.replaceAll('__APP_PACKAGE__', appPackage));
    await fs.mkdir(resourcePath, { recursive: true });
    await fs.writeFile(
      path.join(resourcePath, 'automotive_app_desc.xml'),
      '<?xml version="1.0" encoding="utf-8"?>\n<automotiveApp xmlns:android="http://schemas.android.com/apk/res/android">\n    <uses name="template" />\n</automotiveApp>\n',
    );
    await fs.mkdir(valuesPath, { recursive: true });
    await fs.writeFile(
      path.join(valuesPath, 'fuel_finder_car_hosts.xml'),
      '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string-array name="fuel_finder_car_host_signatures">\n        <!-- Add digest,package-name pairs for approved hosts before release. -->\n    </string-array>\n</resources>\n',
    );
    return modConfig;
  }]);
}

module.exports = withFuelFinderAndroidAuto;