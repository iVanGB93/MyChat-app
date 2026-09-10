const { withGradleProperties } = require('@expo/config-plugins');

// React Native's image reader needs Fresco's animated WebP decoder, even
// when the sticker itself is displayed by expo-image and copied unchanged.
module.exports = function withAnimatedWebp(config) {
  return withGradleProperties(config, (modConfig) => {
    for (const key of ['expo.webp.enabled', 'expo.webp.animated']) {
      modConfig.modResults = modConfig.modResults.filter(
        (entry) => entry.type !== 'property' || entry.key !== key,
      );
      modConfig.modResults.push({ type: 'property', key, value: 'true' });
    }
    return modConfig;
  });
};
