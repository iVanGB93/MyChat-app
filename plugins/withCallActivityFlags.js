/**
 * withCallActivityFlags
 *
 * Makes the main activity able to appear over the lockscreen and wake the
 * screen so an incoming-call full-screen intent actually TAKES OVER the
 * display (like WhatsApp / the phone dialer) instead of only showing a
 * heads-up banner.
 *
 * Adds to <activity android:name=".MainActivity">:
 *   android:showWhenLocked="true"   → activity shows on top of the keyguard
 *   android:turnScreenOn="true"     → device screen turns on when it launches
 *
 * Both are manifest attributes supported on API 27+ (equivalent to the
 * Activity.setShowWhenLocked / setTurnScreenOn calls). Combined with the
 * notification's fullScreenAction + USE_FULL_SCREEN_INTENT permission and the
 * CATEGORY_CALL notification, the incoming-call screen takes over the screen.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const withCallActivityFlags = (config) =>
  withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app || !Array.isArray(app.activity)) return cfg;

    const mainActivity = app.activity.find(
      (a) => a.$?.['android:name'] === '.MainActivity',
    );
    if (mainActivity) {
      mainActivity.$['android:showWhenLocked'] = 'true';
      mainActivity.$['android:turnScreenOn'] = 'true';
    }
    return cfg;
  });

module.exports = withCallActivityFlags;
