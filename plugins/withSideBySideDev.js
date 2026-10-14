const { withAppBuildGradle, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const marker = '// Axonic optional side-by-side development build';
const bundleFallback = `
// Headless Firebase starts before Dev Launcher selects Metro. Supply its asset fallback.
// This controls bundling only; Android debug/Metro support remains enabled.
if (project.findProperty('axonicSideBySide') == 'true') {
    react { debuggableVariants = [] }
}
`;
const gradle = `
${marker}
${bundleFallback}
android {
    defaultConfig {
        manifestPlaceholders += [axonicAppLabel: "Axonic", axonicScheme: "axonic", axonicExpoScheme: "exp+mychat-app"]
    }
    buildTypes {
        debug {
            if (project.findProperty('axonicSideBySide') == 'true') {
                applicationIdSuffix '.dev'
                manifestPlaceholders += [axonicAppLabel: "Axonic Dev", axonicScheme: "axonic-dev", axonicExpoScheme: "exp+axonic-dev"]
            }
        }
    }
}
`;

function configureManifest(manifest) {
  const app = manifest.application[0];
  app.$['android:label'] = '${axonicAppLabel}';
  for (const activity of app.activity || []) {
    for (const filter of activity['intent-filter'] || []) {
      for (const data of filter.data || []) {
        if (data.$['android:scheme'] === 'axonic') data.$['android:scheme'] = '${axonicScheme}';
        if (data.$['android:scheme'] === 'exp+mychat-app') data.$['android:scheme'] = '${axonicExpoScheme}';
      }
      if (filter.data) filter.data = filter.data.filter((data, index, entries) =>
        entries.findIndex(other => JSON.stringify(other.$) === JSON.stringify(data.$)) === index);
    }
  }
  return manifest;
}

// Local Gradle builds use the same display version as Expo; version codes stay release-owned.
function configureVersionName(contents) {
  return contents.replace(/versionName\s+["'][^"']+["']/g,
    "versionName new groovy.json.JsonSlurper().parse(rootProject.file('../app.json')).expo.version");
}

function configureGradle(contents) {
  const versioned = configureVersionName(contents);
  if (!versioned.includes(marker)) return versioned + gradle;
  if (versioned.includes('react { debuggableVariants = [] }')) return versioned;
  return versioned.replace(marker, marker + '\n' + bundleFallback);
}

module.exports = function withSideBySideDev(config) {
  config = withDangerousMod(config, ['android', mod => {
    const source = path.join(mod.modRequest.projectRoot, 'builds', 'google-services.json');
    if (fs.existsSync(source)) {
      const target = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'debug', 'google-services.json');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
    return mod;
  }]);
  config = withAndroidManifest(config, mod => {
    mod.modResults.manifest = configureManifest(mod.modResults.manifest);
    return mod;
  });
  return withAppBuildGradle(config, mod => {
    mod.modResults.contents = configureGradle(mod.modResults.contents);
    return mod;
  });
};
module.exports.gradle = gradle;
module.exports.configureManifest = configureManifest;

module.exports.configureVersionName = configureVersionName;
module.exports.configureGradle = configureGradle;
