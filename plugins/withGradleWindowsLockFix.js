const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('@expo/config-plugins');

/**
 * Gradle 9.0 can fail on Windows while moving dependency transforms because
 * its own daemon still holds a file lock. Gradle fixed the locking strategy in
 * 9.1. Keep Expo-generated SDK 55 projects on that fixed patch line without
 * pinning future Expo SDKs to an old Gradle release.
 *
 * https://github.com/gradle/gradle/issues/31438
 */
module.exports = function withGradleWindowsLockFix(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const wrapperPath = path.join(
        modConfig.modRequest.platformProjectRoot,
        'gradle',
        'wrapper',
        'gradle-wrapper.properties',
      );

      if (!fs.existsSync(wrapperPath)) {
        throw new Error(`Gradle wrapper not found after Android prebuild: ${wrapperPath}`);
      }

      const source = fs.readFileSync(wrapperPath, 'utf8');
      const gradle90 = 'gradle-9.0.0-bin.zip';
      const gradle91 = 'gradle-9.1.0-bin.zip';

      if (source.includes(gradle90)) {
        fs.writeFileSync(wrapperPath, source.replace(gradle90, gradle91), 'utf8');
        console.log('[Gradle Windows] Updated wrapper 9.0.0 -> 9.1.0.');
      }

      return modConfig;
    },
  ]);
};
