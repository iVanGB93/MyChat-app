// Pinned native extension: crop only this screen track's local controls before encoding.
function replaceOnce(source,before,after){if(source.split(before).length!==2)throw Error('Unexpected screen exclusion source; review native dependency');return source.replace(before,after);}
function patchExclusion(source,kind,version){
 if(version!=='124.0.7')throw Error('Review screen exclusion for this WebRTC version');
 source=source.replace(/\r\n/g,'\n');
 if(kind==='controller'&&source.includes('// Axonic: screen control exclusion.')&&!source.includes('// Axonic: capture startup evidence.'))return replaceOnce(source,'    private volatile double excludedBottomFraction = 0;',startup+'\n    private volatile double excludedBottomFraction = 0;');
 if(source.includes('// Axonic: screen control exclusion.'))return source;
 if(kind==='controller')return replaceOnce(source,'    @Override\n    public String getDeviceId()',`    // Axonic: screen control exclusion.
${startup}
    private volatile double excludedBottomFraction = 0;
    public void setExcludedBottomFraction(double fraction) { excludedBottomFraction = fraction; }
    public org.webrtc.CapturerObserver captureObserver(org.webrtc.CapturerObserver observer) {
        return new org.webrtc.CapturerObserver() {
            public void onCapturerStarted(boolean success) { observer.onCapturerStarted(success); }
            public void onCapturerStopped() { observer.onCapturerStopped(); }
            public void onFrameCaptured(org.webrtc.VideoFrame frame) {
                double fraction = excludedBottomFraction;
                if (fraction <= 0) { observer.onFrameCaptured(frame); return; }
                org.webrtc.VideoFrame.Buffer buffer = frame.getBuffer();
                int width = buffer.getWidth(), height = buffer.getHeight(), x = 0, y = 0;
                int rotation = frame.getRotation();
                int edge = rotation == 90 || rotation == 270 ? width : height;
                int cut = Math.min(edge - 2, ((int) Math.ceil(edge * fraction / 2)) * 2);
                if (cut <= 0) { observer.onFrameCaptured(frame); return; }
                if (rotation == 90) width -= cut;
                else if (rotation == 270) { x = cut; width -= cut; }
                else if (rotation == 180) { y = cut; height -= cut; }
                else height -= cut;
                org.webrtc.VideoFrame cropped = new org.webrtc.VideoFrame(
                    buffer.cropAndScale(x, y, width, height, width, height), rotation, frame.getTimestampNs());
                try { observer.onFrameCaptured(cropped); } finally { cropped.release(); }
            }
        };
    }

    @Override
    public String getDeviceId()`);
 if(kind==='capture'){
  source=replaceOnce(source,'videoCapturer.initialize(surfaceTextureHelper, reactContext, videoSource.getCapturerObserver());',`videoCapturer.initialize(surfaceTextureHelper, reactContext,
                videoCaptureController instanceof ScreenCaptureController
                    ? ((ScreenCaptureController) videoCaptureController).captureObserver(videoSource.getCapturerObserver())
                    : videoSource.getCapturerObserver());`);
  return replaceOnce(source,'    void applyConstraints(String trackId, ReadableMap constraints, Promise promise) {',`    // Axonic: screen control exclusion.
    void setScreenExcludedBottom(String trackId, double fraction, Promise promise) {
        TrackPrivate track = tracks.get(trackId);
        if (track == null || !(track.videoCaptureController instanceof ScreenCaptureController)
                || !Double.isFinite(fraction) || fraction < 0 || fraction > 0.45) {
            promise.reject(new IllegalArgumentException("Invalid screen exclusion")); return;
        }
        ((ScreenCaptureController) track.videoCaptureController).setExcludedBottomFraction(fraction);
        promise.resolve(null);
    }
    void applyConstraints(String trackId, ReadableMap constraints, Promise promise) {`);
 }
 if(kind==='module')return replaceOnce(source,'    @ReactMethod\n    public void mediaStreamTrackApplyConstraints(String id, ReadableMap constraints, Promise promise) {',`    // Axonic: screen control exclusion.
    @ReactMethod
    public void mediaStreamTrackSetScreenExcludedBottom(String id, double fraction, Promise promise) {
        ThreadUtils.runOnExecutor(() -> getUserMediaImpl.setScreenExcludedBottom(id, fraction, promise));
    }
    @ReactMethod
    public void mediaStreamTrackApplyConstraints(String id, ReadableMap constraints, Promise promise) {`);
 throw Error('Unknown screen exclusion target');
}
const startup=`    // Axonic: capture startup evidence.
    @Override public void startCapture() {
        try { videoCapturer.startCapture(targetWidth, targetHeight, targetFps); }
        catch (RuntimeException error) {
            Log.e(TAG, "Screen capture failed to start", error);
            if (capturerEventsListener != null) capturerEventsListener.onCapturerEnded();
        }
    }`;
// Identity guard hashing must validate the pinned upstream file, while preserving this exact extension.
function stripModuleExclusion(source){
 const block=`    // Axonic: screen control exclusion.
    @ReactMethod
    public void mediaStreamTrackSetScreenExcludedBottom(String id, double fraction, Promise promise) {
        ThreadUtils.runOnExecutor(() -> getUserMediaImpl.setScreenExcludedBottom(id, fraction, promise));
    }
`;
 if(!source.includes('// Axonic: screen control exclusion.'))return source;
 return replaceOnce(source,block,'');
}
module.exports={patchExclusion,stripModuleExclusion};
