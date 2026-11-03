const fs = require('node:fs/promises');
const path = require('node:path');
const {
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require('@expo/config-plugins');

const sceneRole = 'CPTemplateApplicationSceneSessionRoleApplication';

function withFuelFinderCarPlay(config) {
  config = withInfoPlist(config, (modConfig) => {
    const infoPlist = modConfig.modResults;
    const sceneManifest = infoPlist.UIApplicationSceneManifest ?? {
      UIApplicationSupportsMultipleScenes: true,
      UISceneConfigurations: {},
    };
    sceneManifest.UIApplicationSupportsMultipleScenes = true;
    const sceneConfigurations = sceneManifest.UISceneConfigurations ?? {};
    const configurations = sceneConfigurations[sceneRole] ?? [];
    const sceneDelegate = '$(PRODUCT_MODULE_NAME).CarPlaySceneDelegate';
    if (!configurations.some((item) => item.UISceneDelegateClassName === sceneDelegate)) {
      configurations.push({
        UISceneConfigurationName: 'Fuel Finder CarPlay',
        UISceneClassName: 'CPTemplateApplicationScene',
        UISceneDelegateClassName: sceneDelegate,
      });
    }
    sceneConfigurations[sceneRole] = configurations;
    sceneManifest.UISceneConfigurations = sceneConfigurations;
    infoPlist.UIApplicationSceneManifest = sceneManifest;
    infoPlist.FUEL_FINDER_API_BASE_URL = process.env.EXPO_PUBLIC_FUEL_FINDER_API_BASE_URL || 'http://localhost:3000';
    return modConfig;
  });

  config = withEntitlementsPlist(config, (modConfig) => {
    if (process.env.FUEL_FINDER_ENABLE_CARPLAY_NAVIGATION_ENTITLEMENT === 'true') {
      modConfig.modResults['com.apple.developer.carplay-maps'] = true;
    }
    return modConfig;
  });

  config = withXcodeProject(config, (modConfig) => {
    const project = modConfig.modResults;
    const sourceFile = 'CarPlaySceneDelegate.swift';
    const references = project.hash.project.objects.PBXFileReference;
    const alreadyAdded = Object.values(references).some(
      (reference) => reference && reference.path === 'CarPlaySceneDelegate.swift',
    );
    if (!alreadyAdded) {
      const appGroup = project.pbxGroupByName(modConfig.name.replace(/[^A-Za-z0-9]/g, ''));
      project.addSourceFile(sourceFile, { target: project.getFirstTarget().uuid }, appGroup?.uuid);
    }
    return modConfig;
  });

  return withDangerousMod(config, ['ios', async (modConfig) => {
    const projectName = modConfig.modRequest.projectName;
    const projectRoot = modConfig.modRequest.projectRoot;
    const platformRoot = modConfig.modRequest.platformProjectRoot;
    const sourcePath = path.join(projectRoot, 'plugins', 'carplay', 'CarPlaySceneDelegate.swift');
    const targetPath = path.join(platformRoot, projectName, 'CarPlaySceneDelegate.swift');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    return modConfig;
  }]);
}

module.exports = withFuelFinderCarPlay;