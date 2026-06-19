/**
 * withFirebaseManifestFix
 *
 * expo-notifications and @react-native-firebase/messaging BOTH declare the
 * Firebase default-notification meta-data (channel id, color, icon) in the
 * Android manifest with different values, which fails the manifest merger:
 *   Attribute meta-data#com.google.firebase.messaging.default_notification_*
 *   is also present at [:react-native-firebase_messaging] ...
 *
 * This plugin adds `tools:replace` to those meta-data nodes in the app
 * manifest so the app's (expo-notifications) values win over the library's.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const FIREBASE_META = {
  'com.google.firebase.messaging.default_notification_channel_id': 'android:value',
  'com.google.firebase.messaging.default_notification_color': 'android:resource',
  'com.google.firebase.messaging.default_notification_icon': 'android:resource',
};

module.exports = function withFirebaseManifestFix(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app || !Array.isArray(app['meta-data'])) return cfg;

    for (const node of app['meta-data']) {
      const name = node?.$?.['android:name'];
      const attr = FIREBASE_META[name];
      if (attr) {
        node.$['tools:replace'] = attr;
      }
    }
    return cfg;
  });
};
