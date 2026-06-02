/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Expo config plugin — copies the ringtone MP3 into the native Android
 * `res/raw/` folder so it can be referenced as a notification channel sound.
 *
 * Notifee's `sound: 'ringtone'` resolves to `res/raw/ringtone.mp3` on Android.
 * (Filename must be lowercase, no spaces, no dashes — only letters / digits /
 * underscores. `ringtone` is fine.)
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const RINGTONE_SRC = path.resolve(__dirname, '../assets/sounds/ringtone.mp3');

module.exports = function withRingtoneRaw(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const rawDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'res',
        'raw',
      );
      const dest = path.join(rawDir, 'ringtone.mp3');
      try {
        if (!fs.existsSync(RINGTONE_SRC)) {
          console.warn('[withRingtoneRaw] source missing:', RINGTONE_SRC);
          return cfg;
        }
        fs.mkdirSync(rawDir, { recursive: true });
        fs.copyFileSync(RINGTONE_SRC, dest);
        console.log('[withRingtoneRaw] copied ringtone →', dest);
      } catch (err) {
        console.warn('[withRingtoneRaw] copy failed:', err);
      }
      return cfg;
    },
  ]);
};
