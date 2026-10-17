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
if(require.main===module){
 const root=path.resolve(__dirname,'..','node_modules','react-native-webrtc');
 const file=path.join(root,'android/src/main/java/com/oney/WebRTCModule/GetUserMediaImpl.java');
 fs.writeFileSync(file,patch(fs.readFileSync(file,'utf8'),JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version));
 console.log('WebRTC full-screen capture prompt configured');
}
module.exports={patch};
