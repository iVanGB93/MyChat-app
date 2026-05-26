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

    // Permissions
    if (!manifest['uses-permission']) manifest['uses-permission'] = [];
    const perms = manifest['uses-permission'];
    const addPerm = (name) => {
      if (!perms.some((p) => p.$?.['android:name'] === name))
        perms.push({ $: { 'android:name': name } });
    };
    addPerm('android.permission.FOREGROUND_SERVICE');
    addPerm('android.permission.FOREGROUND_SERVICE_SPECIAL_USE');

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

      // Add our service with specialUse foreground type + property
      app.service.push({
        $: {
          'android:name': '.MyChatForegroundService',
          'android:exported': 'false',
          'android:foregroundServiceType': 'specialUse',
          'android:stopWithTask': 'false',
        },
        property: [
          {
            $: {
              'android:name':
                'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
              'android:value': 'background_connectivity',
            },
          },
        ],
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
