const fs = require('node:fs');
const path = require('node:path');

const settingsPath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@react-native',
  'gradle-plugin',
  'settings.gradle.kts',
);

const outdated = 'org.gradle.toolchains.foojay-resolver-convention").version("0.5.0")';
const compatible = 'org.gradle.toolchains.foojay-resolver-convention").version("1.0.0")';

if (!fs.existsSync(settingsPath)) {
  throw new Error(`React Native Gradle plugin settings not found: ${settingsPath}`);
}

const source = fs.readFileSync(settingsPath, 'utf8');
if (source.includes(compatible)) {
  console.log('[Gradle 9] Foojay resolver is already compatible.');
  process.exit(0);
}
if (!source.includes(outdated)) {
  throw new Error(
    'React Native changed its Foojay resolver declaration; review this compatibility patch before building.',
  );
}

fs.writeFileSync(settingsPath, source.replace(outdated, compatible), 'utf8');
console.log('[Gradle 9] Updated React Native Foojay resolver 0.5.0 -> 1.0.0.');
