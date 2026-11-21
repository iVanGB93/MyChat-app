const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = (config) => withAndroidManifest(config, (configWithManifest) => {
  const manifest = configWithManifest.modResults.manifest;
  const optionalHardware = ['android.hardware.screen.portrait', 'android.hardware.wifi'];
  const features = manifest['uses-feature'] ?? [];

  // Explicit optional declarations override Play's inference from orientation
  // and multicast permissions while preserving the existing app behavior.
  manifest['uses-feature'] = [
    ...features.filter((feature) => !optionalHardware.includes(feature.$['android:name'])),
    ...optionalHardware.map((name) => ({ $: { 'android:name': name, 'android:required': 'false' } })),
  ];
  return configWithManifest;
});
