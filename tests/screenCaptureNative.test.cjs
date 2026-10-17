const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {patch}=require('../scripts/patch-webrtc-screen-capture.cjs');
test('native capture requests the entire display on Android 14 with a compatible older-Android fallback',()=>{
 const input='currentActivity.startActivityForResult(\nmediaProjectionManager.createScreenCaptureIntent(), PERMISSION_REQUEST_CODE);';
 const result=patch(input,'124.0.7');assert.match(result,/SDK_INT >= 34/);assert.match(result,/createConfigForDefaultDisplay/);
 assert.match(result,/: mediaProjectionManager.createScreenCaptureIntent\(\)/);assert.equal(patch(result,'124.0.7'),result);
 assert.throws(()=>patch(input,'999'),/Review/);assert.throws(()=>patch('changed source','124.0.7'),/Unexpected/);
});
test('screen capture permission, notification icon and startup configuration survive prebuild',()=>{
 const plugin=fs.readFileSync('plugins/withForegroundService.js','utf8');
 const manifest=fs.readFileSync('android/app/src/main/AndroidManifest.xml','utf8');
 assert.match(plugin,/FOREGROUND_SERVICE_MEDIA_PROJECTION/);assert.match(manifest,/FOREGROUND_SERVICE_MEDIA_PROJECTION/);
 assert.match(plugin,/enableMediaProjectionService = true/);assert.match(plugin,/name="ic_notification"/);
 assert.match(fs.readFileSync('package.json','utf8'),/patch-webrtc-screen-capture.cjs/);
});
