const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
cp.execFileSync(process.execPath, [path.join(__dirname, 'patch-activity-result.cjs')], {stdio: 'inherit'});
const destination = path.join(root, 'node_modules/expo-modules-core/android/src/test/java/expo/modules/kotlin/activityresult/ActivityResultRecreationTest.kt');
fs.mkdirSync(path.dirname(destination), {recursive: true});
fs.copyFileSync(path.join(root, 'tests/native/ActivityResultRecreationTest.kt'), destination);
const result = cp.spawnSync(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [
  ':expo-modules-core:testDebugUnitTest', '--tests', 'expo.modules.kotlin.activityresult.ActivityResultRecreationTest',
  '-PreactNativeArchitectures=arm64-v8a', '-PaxonicSideBySide=true', '--console=plain',
], {cwd: path.join(root, 'android'), stdio: 'inherit', shell: process.platform === 'win32'});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
