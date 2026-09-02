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
const {
  withAndroidManifest,
  withDangerousMod,
  withPlugins,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withCallActivityManifest = (config) =>
  withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app || !Array.isArray(app.activity)) return cfg;

    const mainActivity = app.activity.find(
      (a) => a.$?.['android:name'] === '.MainActivity',
    );
    if (mainActivity) {
      mainActivity.$['android:showWhenLocked'] = 'true';
      mainActivity.$['android:turnScreenOn'] = 'true';
      mainActivity.$['android:supportsPictureInPicture'] = 'true';
      mainActivity.$['android:resizeableActivity'] = 'true';

      const requiredChanges = [
        'keyboard',
        'keyboardHidden',
        'orientation',
        'screenSize',
        'screenLayout',
        'uiMode',
        'smallestScreenSize',
      ];
      const existingChanges = (mainActivity.$['android:configChanges'] || '')
        .split('|')
        .filter(Boolean);
      mainActivity.$['android:configChanges'] = [
        ...new Set([...existingChanges, ...requiredChanges]),
      ].join('|');
    }
    return cfg;
  });

const withCallPictureInPictureActivity = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const packagePath = (
        cfg.android?.package ||
        cfg.expo?.android?.package ||
        'com.axonic'
      ).replace(/\./g, path.sep);
      const activityPath = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        packagePath,
        'MainActivity.kt',
      );

      if (!fs.existsSync(activityPath)) return cfg;
      let source = fs.readFileSync(activityPath, 'utf8');

      if (!source.includes('import android.app.PictureInPictureParams')) {
        source = source.replace(
          /package ([^\r\n]+)\r?\n/,
          'package $1\n\nimport android.app.PictureInPictureParams',
        );
      }
      if (!source.includes('import android.util.Rational')) {
        source = source.replace(
          'import android.os.Bundle',
          'import android.os.Bundle\nimport android.util.Rational',
        );
      }

      if (!source.includes('override fun onUserLeaveHint()')) {
        const method = `
  /** Android 8-11 fallback; Android 12+ uses native auto-enter PiP. */
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      Build.VERSION.SDK_INT < Build.VERSION_CODES.S &&
      MyChatServiceModule.pictureInPictureEnabled &&
      !isInPictureInPictureMode
    ) {
      val params = PictureInPictureParams.Builder()
        .setAspectRatio(Rational(9, 16))
        .build()
      enterPictureInPictureMode(params)
    }
  }

`;
        source = source.replace(
          '  override fun invokeDefaultOnBackPressed()',
          `${method}  override fun invokeDefaultOnBackPressed()`,
        );
      }

      fs.writeFileSync(activityPath, source, 'utf8');
      return cfg;
    },
  ]);

module.exports = function withCallActivityFlags(config) {
  return withPlugins(config, [
    withCallActivityManifest,
    withCallPictureInPictureActivity,
  ]);
}
