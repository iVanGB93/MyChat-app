// Firebase/Notifee use these resources without Expo's notification runtime.
const { withDangerousMod, withAndroidColors, withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');
const { generateImageAsync } = require('@expo/image-utils');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = function withNotificationResources(config, { icon, color }) {
  config = withAndroidColors(config, mod => {
    mod.modResults = AndroidConfig.Colors.assignColorValue(mod.modResults, {
      name: 'notification_icon_color', value: color,
    });
    return mod;
  });
  config = withAndroidManifest(config, mod => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    app['meta-data'] = (app['meta-data'] || []).filter(node =>
      !node.$['android:name'].startsWith('expo.modules.notifications.'));
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    for (const [density, size] of Object.entries({ mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 })) {
      const folder = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res', `drawable-${density}`);
      const { source } = await generateImageAsync({
        projectRoot: mod.modRequest.projectRoot, cacheType: 'axonic-notification',
      }, { src: icon, width: size, height: size, resizeMode: 'cover', backgroundColor: 'transparent' });
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, 'notification_icon.png'), source);
    }
    return mod;
  }]);
};
