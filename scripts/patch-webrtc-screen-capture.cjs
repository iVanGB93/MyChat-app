const fs=require('node:fs'),path=require('node:path');
const stock='mediaProjectionManager.createScreenCaptureIntent(), PERMISSION_REQUEST_CODE);';
const replacement=`// Axonic: this call feature shares the entire display, including other apps.
                            (android.os.Build.VERSION.SDK_INT >= 34
                                ? mediaProjectionManager.createScreenCaptureIntent(android.media.projection.MediaProjectionConfig.createConfigForDefaultDisplay())
                                : mediaProjectionManager.createScreenCaptureIntent()), PERMISSION_REQUEST_CODE);`;
function patch(source,version){
 if(version!=='124.0.7')throw Error('Review screen capture support for this WebRTC version');
 const normalized=source.replace(/\r\n/g,'\n');
 if(normalized.includes(replacement))return normalized;
 if(normalized.split(stock).length!==2)throw Error('Unexpected screen capture permission flow; review before building');
 return normalized.replace(stock,replacement);
}
function patchController(source,version){
 if(version!=='124.0.7')throw Error('Review screen capture support for this WebRTC version');
 let value=source.replace(/\r\n/g,'\n');
 if(value.includes('// Axonic: bounded screen capture at the source.'))return value;
 const replace=(before,after)=>{if(value.split(before).length!==2)throw Error('Unexpected screen capture controller; review before building');value=value.replace(before,after);};
 replace('private static final int DEFAULT_FPS = 30;',`// Axonic: bounded screen capture at the source.
    private static final int DEFAULT_FPS = 15;
    private static int captureDimension(int dimension, int other) {
        double scale = Math.min(1.0, 1600.0 / Math.max(dimension, other));
        return Math.max(2, ((int) (dimension * scale) / 2) * 2);
    }`);
 replace('super(width, height, DEFAULT_FPS);','super(captureDimension(width, height), captureDimension(height, width), DEFAULT_FPS);');
 replace('final int width = displayMetrics.widthPixels;\n                final int height = displayMetrics.heightPixels;',`final int width = captureDimension(displayMetrics.widthPixels, displayMetrics.heightPixels);
                final int height = captureDimension(displayMetrics.heightPixels, displayMetrics.widthPixels);`);
 replace('videoCapturer.changeCaptureFormat(width, height, DEFAULT_FPS);',`if (videoCapturer == null || (targetWidth == width && targetHeight == height)) return;
                        videoCapturer.changeCaptureFormat(width, height, DEFAULT_FPS);
                        targetWidth = actualWidth = width;
                        targetHeight = actualHeight = height;`);
 replace('MediaProjectionService.abort(context);','orientationListener.disable();\n        MediaProjectionService.abort(context);');
 return value;
}
if(require.main===module){
 const root=path.resolve(__dirname,'..','node_modules','react-native-webrtc');
 const file=path.join(root,'android/src/main/java/com/oney/WebRTCModule/GetUserMediaImpl.java');
 fs.writeFileSync(file,patch(fs.readFileSync(file,'utf8'),JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version));
 const controller=path.join(root,'android/src/main/java/com/oney/WebRTCModule/ScreenCaptureController.java');
 fs.writeFileSync(controller,patchController(fs.readFileSync(controller,'utf8'),JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version));
 const {patchExclusion}=require('./patch-webrtc-screen-exclusion.cjs');
 for(const [name,kind] of [['ScreenCaptureController.java','controller'],['GetUserMediaImpl.java','capture'],['WebRTCModule.java','module']]){
  const target=path.join(root,'android/src/main/java/com/oney/WebRTCModule',name);
  fs.writeFileSync(target,patchExclusion(fs.readFileSync(target,'utf8'),kind,JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version));
 }
 const {patchStartup}=require('./patch-webrtc-screen-startup.cjs');
 for(const [name,kind] of [['MediaProjectionService.java','service'],['GetUserMediaImpl.java','capture'],['ScreenCaptureController.java','controller']]){
  const target=path.join(root,'android/src/main/java/com/oney/WebRTCModule',name);
  fs.writeFileSync(target,patchStartup(fs.readFileSync(target,'utf8'),kind,JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version));
 }
 console.log('WebRTC full-screen capture prompt configured');
}
module.exports={patch,patchController};
