// Generates test-only assets from the exact production retry-policy source.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const target=path.join(root,'android/app/src/androidTest');
fs.mkdirSync(path.join(target,'assets'),{recursive:true});fs.mkdirSync(path.join(target,'java/com/axonic'),{recursive:true});
const production=ts.transpileModule(fs.readFileSync(path.join(root,'src/modules/storage/storageReadSafety.ts'),'utf8'),{compilerOptions:{module:1,target:9}}).outputText;
fs.writeFileSync(path.join(target,'assets/storage-safety.js'),'const exports={};\n'+production+'\n'+fs.readFileSync(path.join(root,'tests/native/storage-safety-device.js'),'utf8'));
fs.copyFileSync(path.join(root,'tests/native/ChatStorageRecoveryInstrumentation.kt'),path.join(target,'java/com/axonic/ChatStorageRecoveryInstrumentation.kt'));
if(!/testInstrumentationRunner[^\n]*"com\.axonic\.ChatStorageRecoveryInstrumentation"/.test(fs.readFileSync(path.join(root,'android/app/build.gradle'),'utf8')))throw Error('Set the test-only runner in app build.gradle before building the test APK.');
console.log('Dev-only storage safety instrumentation prepared from current source');
