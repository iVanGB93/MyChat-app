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

// For each conflicting Firebase meta-data node we need to know:
//  - attr:    which attribute to mark with tools:replace
//  - default: the value to use ONLY when we have to create the node ourselves
//             (these mirror what expo-notifications / our config generates)
const FIREBASE_META = {
  'com.google.firebase.messaging.default_notification_channel_id': {
    attr: 'android:value',
    default: 'messages',
  },
  'com.google.firebase.messaging.default_notification_color': {
    attr: 'android:resource',
    default: '@color/notification_icon_color',
  },
  'com.google.firebase.messaging.default_notification_icon': {
    attr: 'android:resource',
    default: '@drawable/notification_icon',
  },
};

/**
 * This mod is order-independent. Whether it runs before or after the
 * expo-notifications / firebase mods that inject these meta-data nodes:
 *  - If the node already exists, we just add `tools:replace`.
 *  - If it does not exist yet, we CREATE it with `tools:replace`. Expo's
 *    `addMetaDataItemToMainApplication` updates existing nodes in place
 *    (matching by android:name), so a later mod will keep our tools:replace.
 */
module.exports = function withFirebaseManifestFix(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // Defensive: ensure the `tools` namespace is declared so tools:replace is valid.
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    const app = manifest.application?.[0];
    if (!app) return cfg;
    if (!Array.isArray(app['meta-data'])) app['meta-data'] = [];

    for (const [name, { attr, default: defaultValue }] of Object.entries(FIREBASE_META)) {
      let node = app['meta-data'].find((n) => n?.$?.['android:name'] === name);
      if (!node) {
        node = { $: { 'android:name': name, [attr]: defaultValue } };
        app['meta-data'].push(node);
      }
      node.$['tools:replace'] = attr;
    }

    return cfg;
  });
};
