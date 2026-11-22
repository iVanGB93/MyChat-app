/**
 * withCallActivityFlags
 *
 * Incoming-call notification intents use a private activity to grant a
 * temporary lock-screen window to MainActivity. Ordinary launches use the
 * default Android keyguard policy.
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
      delete mainActivity.$['android:showWhenLocked'];
      delete mainActivity.$['android:turnScreenOn'];
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
    const callActivity = {
      $: {
        'android:name': '.CallNotificationActivity',
        'android:exported': 'false',
        'android:excludeFromRecents': 'true',
        'android:taskAffinity': '',
        'android:showWhenLocked': 'true',
        'android:theme': '@android:style/Theme.NoDisplay',
      },
    };
    const existing = app.activity.findIndex(activity => activity.$?.['android:name'] === '.CallNotificationActivity');
    if (existing === -1) app.activity.push(callActivity);
    else app.activity[existing] = callActivity;
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
      fs.copyFileSync(path.join(__dirname, 'android', 'CallNotificationActivity.kt'),
        path.join(path.dirname(activityPath), 'CallNotificationActivity.kt'));
      let source = fs.readFileSync(activityPath, 'utf8');

      if (!source.includes('private val incomingCallWindow')) {
        if (!source.includes('import android.content.Intent')) {
          source = source.replace('import android.os.Bundle', 'import android.content.Intent\nimport android.os.Bundle');
        }
        source = source.replace('  override fun onCreate(savedInstanceState: Bundle?) {', `  private val incomingCallWindow = IncomingCallWindow(this)

  override fun onNewIntent(intent: Intent) {
    incomingCallWindow.apply(intent)
    super.onNewIntent(intent)
  }

  fun clearIncomingCallWindow(callId: String) = incomingCallWindow.clear(callId)
  fun markIncomingCallConnected(callId: String) = incomingCallWindow.markConnected(callId)

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    incomingCallWindow.onWindowFocusChanged(hasFocus)
  }

  override fun onDestroy() {
    incomingCallWindow.clear()
    super.onDestroy()
  }

  override fun onCreate(savedInstanceState: Bundle?) {`);
        source = source.replace('    super.onCreate(null)', '    super.onCreate(null)\n    incomingCallWindow.apply(intent)');
      }

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
