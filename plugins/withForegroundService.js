/* ------------------------------------------------------------------ *
 *  Expo Config Plugin — MyChatForegroundService                       *
 *  Protects ALL custom native Android changes from                    *
 *  `npx expo prebuild --clean`.                                       *
 *                                                                     *
 *  What it does on every prebuild:                                    *
 *  1.  AndroidManifest.xml — adds FOREGROUND_SERVICE permissions and  *
 *      the <service android:name=".MyChatForegroundService"> entry.   *
 *  2.  android/build.gradle — adds google-services classpath.         *
 *  3.  android/app/build.gradle — adds google-services plugin.        *
 *  4.  Copies Kotlin source files from plugins/android/ into the      *
 *      correct package directory.                                     *
 *  5.  Copies google-services.json from plugins/android/ into         *
 *      android/app/.                                                  *
 *  6.  Patches MainApplication.kt to register MyChatServicePackage.  *
 * ------------------------------------------------------------------ */

const {
  withAndroidManifest,
  withProjectBuildGradle,
  withAppBuildGradle,
  withDangerousMod,
  withPlugins,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ─── 1. AndroidManifest.xml ──────────────────────────────────────────
function withManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // Ensure the tools namespace is declared on <manifest>
    if (!manifest.$) manifest.$ = {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    // Permissions
    if (!manifest['uses-permission']) manifest['uses-permission'] = [];
    const perms = manifest['uses-permission'];
    const addPerm = (name) => {
      if (!perms.some((p) => p.$?.['android:name'] === name))
        perms.push({ $: { 'android:name': name } });
    };
    addPerm('android.permission.FOREGROUND_SERVICE');
    addPerm('android.permission.FOREGROUND_SERVICE_MICROPHONE');
    addPerm('android.permission.FOREGROUND_SERVICE_CAMERA');

    // Remove the obsolete special-use declaration. Axonic only starts this
    // service for a user-visible voice/video call, which is covered by the
    // microphone and camera service types.
    manifest['uses-permission'] = manifest['uses-permission'].filter(
      (permission) =>
        permission.$?.['android:name'] !==
        'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
    );

    // Strip permissions Google Play flags that we do NOT actually use.
    // FOREGROUND_SERVICE_MEDIA_PLAYBACK is pulled in transitively by older
    // versions of Firebase / Play Services even though we never play media
    // from a foreground service. Remove via the manifest merger so it does
    // not appear in the merged manifest uploaded to the Play Store.
    const removePermViaMerger = (name) => {
      // A config plugin may already have inserted the permission into this
      // main manifest. Delete every local declaration first; otherwise an
      // added entry can survive beside the tools:node="remove" marker.
      manifest['uses-permission'] = manifest['uses-permission'].filter(
        (permission) => permission.$?.['android:name'] !== name,
      );
      manifest['uses-permission'].push({
        $: {
          'android:name': name,
          'tools:node': 'remove',
        },
      });
    };
    removePermViaMerger('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK');
    // Older Firebase Messaging stubs sometimes inject these too — keep them
    // explicitly stripped so the Play Console pre-launch check stays clean.
    removePermViaMerger('android.permission.FOREGROUND_SERVICE_DATA_SYNC');

    // <service> inside <application>
    const app = manifest.application?.[0];
    if (app) {
      if (!app.service) app.service = [];

      // Remove old supersami entries and any stale MyChatForegroundService
      const stale = [
        'com.supersami.foregroundservice.ForegroundService',
        'com.supersami.foregroundservice.ForegroundServiceTask',
        '.MyChatForegroundService',
      ];
      app.service = app.service.filter(
        (s) => !stale.includes(s.$?.['android:name'])
      );

      // The service exists only for an active, user-visible call. At runtime
      // the native module starts it with microphone for a voice call and
      // microphone|camera for a video call.
      app.service.push({
        $: {
          'android:name': '.MyChatForegroundService',
          'android:exported': 'false',
          'android:foregroundServiceType': 'microphone|camera',
          'android:stopWithTask': 'false',
        },
      });
    }

    return cfg;
  });
}

// ─── 2. android/build.gradle ─────────────────────────────────────────
function withRootBuildGradle(config) {
  return withProjectBuildGradle(config, (cfg) => {
    const dep = "classpath('com.google.gms:google-services:4.4.2')";
    if (!cfg.modResults.contents.includes('com.google.gms:google-services')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /classpath\('com\.facebook\.react:react-native-gradle-plugin'\)/,
        `classpath('com.facebook.react:react-native-gradle-plugin')\n    ${dep}`
      );
    }
    return cfg;
  });
}

// ─── 3. android/app/build.gradle ─────────────────────────────────────
function withAppGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    const plugin = 'apply plugin: "com.google.gms.google-services"';
    if (!cfg.modResults.contents.includes('com.google.gms.google-services')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /apply plugin: "com\.facebook\.react"/,
        `apply plugin: "com.facebook.react"\n${plugin}`
      );
    }
    return cfg;
  });
}

// ─── 4. Copy Kotlin files + google-services.json + patch MainApplication
function withNativeFiles(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const srcDir = path.join(projectRoot, 'plugins', 'android');
      const pkg = (cfg.android?.package || cfg.expo?.android?.package || 'com.axonic').replace(/\./g, '/');
      const javaDir = path.join(
        projectRoot,
        'android', 'app', 'src', 'main',
        'java', ...pkg.split('/')
      );

      // Ensure java package directory exists
      fs.mkdirSync(javaDir, { recursive: true });

      // ── Copy Kotlin source files ──────────────────────────────────
      const kotlinFiles = [
        'MyChatForegroundService.kt',
        'MyChatServiceModule.kt',
        'MyChatServicePackage.kt',
      ];
      for (const file of kotlinFiles) {
        const src = path.join(srcDir, file);
        const dest = path.join(javaDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          console.log(`[withForegroundService] Copied ${file}`);
        } else {
          console.warn(`[withForegroundService] WARNING: ${src} not found`);
        }
      }

      // ── Copy google-services.json ─────────────────────────────────
      const gsSrc = path.join(srcDir, 'google-services.json');
      const gsDest = path.join(projectRoot, 'android', 'app', 'google-services.json');
      if (fs.existsSync(gsSrc)) {
        fs.copyFileSync(gsSrc, gsDest);
        console.log('[withForegroundService] Copied google-services.json');
      } else {
        console.warn('[withForegroundService] WARNING: plugins/android/google-services.json not found');
      }

      // ── Patch MainApplication.kt ──────────────────────────────────
      const mainAppPath = path.join(javaDir, 'MainApplication.kt');
      if (fs.existsSync(mainAppPath)) {
        let content = fs.readFileSync(mainAppPath, 'utf-8');
        const marker = 'add(MyChatServicePackage())';
        if (!content.includes(marker)) {
          content = content.replace(
            'PackageList(this).packages.apply {',
            `PackageList(this).packages.apply {\n              add(MyChatServicePackage())`
          );
          fs.writeFileSync(mainAppPath, content, 'utf-8');
          console.log('[withForegroundService] Patched MainApplication.kt');
        }
      } else {
        console.warn('[withForegroundService] WARNING: MainApplication.kt not found at', mainAppPath);
      }

      return cfg;
    },
  ]);
}

// ─── Compose ─────────────────────────────────────────────────────────
module.exports = function withForegroundService(config) {
  return withPlugins(config, [
    withManifest,
    withRootBuildGradle,
    withAppGradle,
    withNativeFiles,
  ]);
};
