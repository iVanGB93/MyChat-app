// Wait for Android's foreground-service acknowledgement, never an arbitrary sleep.
function patchLegacyStartup(source, kind, version) {
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
function patchStartup(source, kind, version) {
 if(version!=='124.0.7')throw Error('Review screen startup for this WebRTC version');
 let s=source.replace(/\r\n/g,'\n');
 if(s.includes('// Axonic: asynchronous projection startup v2.'))return s;
 s=patchLegacyStartup(s,kind,version);
 const replace=(a,b)=>{if(s.split(a).length!==2)throw Error('Unexpected asynchronous projection source');s=s.replace(a,b);};
 if(kind==='service') {
  const start=s.indexOf('    // Axonic: acknowledged projection startup.');
  const end=s.indexOf('    public static void launch(Context context) {',start);
  if(start<0||end<0||!s.slice(start,end).includes('ready.await(5,'))throw Error('Unexpected projection startup migration');
  s=s.slice(0,start)+`    // Axonic: asynchronous projection startup v2.
    // All state is confined to the main thread; WebRTC's executor never waits for it.
    private static final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    private static java.util.function.Consumer<RuntimeException> pending;
    private static Runnable timeout;
    private RuntimeException promotionFailure;
    public static void launchAsync(Context context, java.util.function.Consumer<RuntimeException> completion) {
        main.post(() -> {
            if (pending != null) {
                ThreadUtils.runOnExecutor(() -> completion.accept(new IllegalStateException("Projection startup already pending")));
                return;
            }
            pending = completion;
            timeout = () -> {
                finish(new IllegalStateException("Projection foreground service acknowledgement timed out"));
                context.stopService(new Intent(context, MediaProjectionService.class));
            };
            main.postDelayed(timeout, 10000);
            try { launch(context); }
            catch (RuntimeException error) { finish(error); }
        });
    }
    private static void finish(RuntimeException error) {
        if (timeout != null) main.removeCallbacks(timeout);
        timeout = null;
        java.util.function.Consumer<RuntimeException> completion = pending;
        pending = null;
        if (completion != null) ThreadUtils.runOnExecutor(() -> completion.accept(error));
    }
    @Override public void onCreate() {
        super.onCreate();
        // Promote before waiting for onStartCommand, before any WebRTC work.
        try { promote(); }
        catch (RuntimeException error) {
            promotionFailure = error;
            Log.e(TAG, "Projection foreground promotion failed", error);
            finish(error);
            stopSelf();
        }
    }
    private void promote() {
        Notification notification = MediaProjectionNotification.buildMediaProjectionNotification(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        else startForeground(NOTIFICATION_ID, notification);
        Log.i(TAG, "Projection foreground ready");
    }
    @Override public void onDestroy() {
        finish(new IllegalStateException("Projection service stopped during startup"));
        super.onDestroy();
    }
`+s.slice(end);
  replace('            Log.w(TAG, "Media projection service not started", e);\n            return;','            Log.w(TAG, "Media projection service not started", e);\n            throw e;');
  replace('            Log.w(TAG, "Media projection service not started");','            throw new IllegalStateException("Media projection service not started");');
  const command=s.indexOf('        Notification notification =',s.indexOf('public int onStartCommand'));
  const commandEnd=s.indexOf('        return START_NOT_STICKY;',command);
  if(command<0||commandEnd<0)throw Error('Unexpected projection onStartCommand');
  s=s.slice(0,command)+`        if (promotionFailure != null) { finish(promotionFailure); stopSelf(); }
        else {
            try { promote(); finish(null); }
            catch (RuntimeException error) {
                Log.e(TAG, "Projection foreground service failed", error);
                finish(error);
                stopSelf();
            }
        }
`+s.slice(commandEnd);
 } else if(kind==='capture') {
  replace('                        // Axonic: acknowledged projection startup.\n                        try {\n                            MediaProjectionService.launchAndAwait(activity);',`                        // Axonic: asynchronous projection startup v2.
                        MediaProjectionService.launchAsync(activity, startupError -> {
                        try {
                            if (startupError != null) throw startupError;`);
  replace('                            mediaProjectionPermissionResultData = null;\n                        }','                            mediaProjectionPermissionResultData = null;\n                        }\n                        });');
 }
 return s;
}
module.exports={patchStartup};
