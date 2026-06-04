/**
 * withNotifeeRepo
 *
 * Notifee distributes its `app.notifee:core` AAR locally inside the npm
 * package (node_modules/@notifee/react-native/android/libs) instead of
 * publishing to Maven Central. The Expo autolinking step does NOT add
 * that path to the project-level repositories, so any time the android/
 * folder is regenerated (`expo prebuild --clean`), gradle fails with:
 *   "Could not find any matches for app.notifee:core:+"
 *
 * This config plugin injects the required `maven { url ... }` line into
 * the root build.gradle on every prebuild so the fix survives.
 */
const { withProjectBuildGradle } = require('@expo/config-plugins');

const NOTIFEE_REPO_LINE =
  "    maven { url \"$rootDir/../node_modules/@notifee/react-native/android/libs\" }";

const MARKER = 'node_modules/@notifee/react-native/android/libs';

function injectNotifeeRepo(contents) {
  if (contents.includes(MARKER)) return contents; // already present

  // Insert just before the closing `}` of the `allprojects { repositories { ... } }` block.
  // Match the first `allprojects { repositories { ... }` and append our maven entry.
  const re = /(allprojects\s*\{\s*repositories\s*\{[\s\S]*?)(\n\s*\}\s*\n\s*\})/m;
  if (!re.test(contents)) {
    console.warn('[withNotifeeRepo] could not find allprojects.repositories block; skipping');
    return contents;
  }
  return contents.replace(re, `$1\n${NOTIFEE_REPO_LINE}$2`);
}

module.exports = function withNotifeeRepo(config) {
  return withProjectBuildGradle(config, (cfg) => {
    cfg.modResults.contents = injectNotifeeRepo(cfg.modResults.contents);
    return cfg;
  });
};
