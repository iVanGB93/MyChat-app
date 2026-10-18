// Wait for Android's foreground-service acknowledgement, never an arbitrary sleep.
function patchStartup(source, kind, version) {
 if(version!=='124.0.7')throw Error('Review screen startup for this WebRTC version');
 let s=source.replace(/\r\n/g,'\n');
 if(s.includes('// Axonic: acknowledged projection startup.'))return s;
 const replace=(a,b)=>{if(s.split(a).length!==2)throw Error('Unexpected screen startup source');s=s.replace(a,b);};
 if(kind==='service'){
  replace('    public static void launch(Context context) {',`    // Axonic: acknowledged projection startup.
    private static volatile java.util.concurrent.CountDownLatch startup;
    private static volatile boolean foregroundReady;
    public static void launchAndAwait(Context context) {
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper())
            throw new IllegalStateException("Projection startup must not block the UI thread");
        java.util.concurrent.CountDownLatch ready = new java.util.concurrent.CountDownLatch(1);
        foregroundReady = false;
        startup = ready;
        launch(context);
        try {
            if (!ready.await(5, java.util.concurrent.TimeUnit.SECONDS) || !foregroundReady) {
                abort(context);
                throw new IllegalStateException("Projection foreground service not ready");
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            abort(context);
            throw new IllegalStateException("Projection startup interrupted", error);
        } finally { if (startup == ready) startup = null; }
    }
    public static void launch(Context context) {`);
  replace('        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {','        try {\n        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {');
  replace('        return START_NOT_STICKY;',`            foregroundReady = true;
        } catch (RuntimeException error) {
            Log.e(TAG, "Projection foreground service failed", error);
            stopSelf();
        } finally {
            java.util.concurrent.CountDownLatch ready = startup;
            if (ready != null) ready.countDown();
        }
        return START_NOT_STICKY;`);
 } else if(kind==='capture') {
  replace('                        MediaProjectionService.launch(activity);\n                        createScreenStream();',`                        // Axonic: acknowledged projection startup.
                        try {
                            MediaProjectionService.launchAndAwait(activity);
                            createScreenStream();
                        } catch (RuntimeException error) {
                            Log.e(TAG, "Screen capture startup rejected", error);
                            MediaProjectionService.abort(activity);
                            if (displayMediaPromise != null) displayMediaPromise.reject("NotReadableError", "Screen capture could not start");
                            displayMediaPromise = null;
                            mediaProjectionPermissionResultData = null;
                        }`);
  replace('        videoCaptureController.startCapture();',`        try { videoCaptureController.startCapture(); }
        catch (RuntimeException error) {
            disposeTrack(id);
            throw error;
        }`);
 } else if(kind==='controller') {
  replace('            if (capturerEventsListener != null) capturerEventsListener.onCapturerEnded();','            // Axonic: acknowledged projection startup.\n            throw error;');
 } else throw Error('Unknown startup patch target');
 return s;
}
module.exports={patchStartup};
