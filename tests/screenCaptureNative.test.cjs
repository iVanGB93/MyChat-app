const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {patch,patchController}=require('../scripts/patch-webrtc-screen-capture.cjs');
const {patchExclusion}=require('../scripts/patch-webrtc-screen-exclusion.cjs');
const {patchStartup}=require('../scripts/patch-webrtc-screen-startup.cjs');
test('capture awaits foreground acknowledgement and rejects failed tracks instead of returning live',()=>{
 const fixture=`    public static void launch(Context context) {
            Log.w(TAG, "Media projection service not started", e);
            return;
            Log.w(TAG, "Media projection service not started");
    }
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = MediaProjectionNotification.buildMediaProjectionNotification(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        }
        return START_NOT_STICKY;
    }`;
 const service=patchStartup(fixture,'service','124.0.7');
 assert.doesNotMatch(service,/CountDownLatch|\.await\(/);
 assert.match(service,/onCreate\(\)[\s\S]*try \{ promote\(\)/);
 assert.match(service,/ThreadUtils.runOnExecutor\(\(\) -> completion.accept\(error\)\)/);
 assert.match(service,/main.removeCallbacks\(timeout\)/);
 assert.match(service,/finish\(null\)/);assert.match(service,/throw e;/);
 assert.equal(patchStartup(service,'service','124.0.7'),service);
 const capture=patchStartup('                        MediaProjectionService.launch(activity);\n                        createScreenStream();\n        videoCaptureController.startCapture();','capture','124.0.7');
 assert.ok(capture.indexOf('launchAsync')<capture.indexOf('createScreenStream'));
 assert.ok(capture.indexOf('if (startupError != null) throw startupError')<capture.indexOf('createScreenStream'));
 assert.match(capture,/reject\("NotReadableError"/);assert.match(capture,/disposeTrack\(id\)/);
 assert.equal(patchStartup(capture,'capture','124.0.7'),capture);
 assert.throws(()=>patchStartup('changed','service','124.0.7'),/Unexpected/);
});
test('screen controls are cropped before encoding, release frame references and leave camera tracks alone',()=>{
 const controller=patchExclusion('    @Override\n    public String getDeviceId()','controller','124.0.7');
 assert.match(controller,/buffer.cropAndScale/);assert.match(controller,/finally \{ cropped.release/);assert.match(controller,/rotation == 270/);assert.match(controller,/volatile double/);
 assert.equal(patchExclusion(controller,'controller','124.0.7'),controller);
 const capture=patchExclusion('videoCapturer.initialize(surfaceTextureHelper, reactContext, videoSource.getCapturerObserver());\n    void applyConstraints(String trackId, ReadableMap constraints, Promise promise) {','capture','124.0.7');
 assert.match(capture,/instanceof ScreenCaptureController/);assert.match(capture,/Double.isFinite/);assert.match(capture,/fraction > 0.45/);
 const module=patchExclusion('    @ReactMethod\n    public void mediaStreamTrackApplyConstraints(String id, ReadableMap constraints, Promise promise) {','module','124.0.7');assert.match(module,/ThreadUtils.runOnExecutor/);
 assert.throws(()=>patchExclusion('changed','controller','124.0.7'),/Unexpected/);assert.throws(()=>patchExclusion('','controller','999'),/Review/);
});
test('screen source caps pixels and frame rate, deduplicates orientation updates and stops its listener',()=>{
 const input=['private static final int DEFAULT_FPS = 30;','super(width, height, DEFAULT_FPS);','final int width = displayMetrics.widthPixels;\n                final int height = displayMetrics.heightPixels;','videoCapturer.changeCaptureFormat(width, height, DEFAULT_FPS);','MediaProjectionService.abort(context);'].join('\n');
 const result=patchController(input,'124.0.7');assert.match(result,/DEFAULT_FPS = 15/);assert.match(result,/1600\.0/);assert.match(result,/targetWidth == width && targetHeight == height/);assert.match(result,/orientationListener.disable\(\)/);assert.equal(patchController(result,'124.0.7'),result);
 assert.throws(()=>patchController(input,'999'),/Review/);assert.throws(()=>patchController('unexpected','124.0.7'),/Unexpected/);
});
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
