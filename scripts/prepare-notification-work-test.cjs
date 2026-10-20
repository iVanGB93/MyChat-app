// Add a separate opt-in instrumentation runner to generated Android test sources.
// It does not run the older storage tests and never ships in the production APK.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'android/app/src/androidTest');
fs.mkdirSync(path.join(dir,'java/com/axonic'),{recursive:true});
fs.copyFileSync(path.join(root,'tests/native/NotificationBlockWorkInstrumentation.kt'),path.join(dir,'java/com/axonic/NotificationBlockWorkInstrumentation.kt'));
const gradle=path.join(root,'android/app/build.gradle');
const original='testInstrumentationRunner "com.axonic.ChatStorageRecoveryInstrumentation"';
const selectable='testInstrumentationRunner (findProperty(\'axonicTestRunner\') ?: "com.axonic.ChatStorageRecoveryInstrumentation")';
const source=fs.readFileSync(gradle,'utf8');
if(!source.includes(original)&&!source.includes(selectable))throw Error('Unknown test runner configuration');
fs.writeFileSync(gradle,source.replace(original,selectable));
console.log('Dev-only notification work instrumentation prepared');
