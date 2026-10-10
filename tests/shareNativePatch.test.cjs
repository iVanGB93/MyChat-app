const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {patch}=require('../scripts/patch-share-intent.cjs');
test('native share patch is repeatable and refuses unsupported source',()=>{
 const source=fs.readFileSync('node_modules/expo-share-intent/android/src/main/java/expo/modules/shareintent/ExpoShareIntentModule.kt','utf8');
 assert.equal(patch(source),source);assert.throws(()=>patch('unknown dependency version'),/Unsupported/);
 assert.throws(()=>patch(source.replace('metadata-only share intake','changed share intake')),/Unsupported/);
 const intake=source.slice(source.indexOf('private fun getFileInfo'),source.indexOf('private fun handleShareIntentChecked'));
 assert.ok(!intake.includes('getAbsolutePath'));assert.ok(!intake.includes('copyTo'));assert.ok(!intake.includes('!!'));assert.match(intake,/catch \(_: Exception\)/);
});
