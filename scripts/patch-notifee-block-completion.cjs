const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const target='node_modules/@notifee/react-native/android/src/main/java/io/invertase/notifee/NotifeeEventSubscriber.java';
const before=`    if (isAppInForeground()) {
      eventMap.putBoolean(KEY_HEADLESS, false);
      NotifeeReactUtils.sendEvent(NOTIFICATION_EVENT_KEY, eventMap);
    } else {
      eventMap.putBoolean(KEY_HEADLESS, true);
      NotifeeReactUtils.startHeadlessTask(
          NOTIFICATION_EVENT_KEY, eventMap, 0, blockStateEvent::setCompletionResult);
    }`;
const after=`    // Axonic: settings-change delivery must release its WorkManager job.
    // This event observes OS policy; it does not carry a message or change settings.
    if (isAppInForeground()) {
      eventMap.putBoolean(KEY_HEADLESS, false);
      try {
        NotifeeReactUtils.sendEvent(NOTIFICATION_EVENT_KEY, eventMap);
      } finally {
        blockStateEvent.setCompletionResult();
      }
    } else {
      eventMap.putBoolean(KEY_HEADLESS, true);
      final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
      final java.util.concurrent.atomic.AtomicBoolean completed = new java.util.concurrent.atomic.AtomicBoolean();
      final Runnable complete = () -> {
        if (completed.compareAndSet(false, true)) blockStateEvent.setCompletionResult();
      };
      // Also bound a failed React-context startup, before a JS task can start.
      handler.postDelayed(complete, 10000);
      try {
        NotifeeReactUtils.startHeadlessTask(NOTIFICATION_EVENT_KEY, eventMap, 10000, () -> {
          handler.removeCallbacks(complete);
          complete.run();
        });
      } catch (RuntimeException | AssertionError error) {
        handler.removeCallbacks(complete);
        complete.run();
        throw error;
      }
    }`;
function patch(input){
 const source=input.replace(/\r\n/g,'\n'),original=source.replace(after,before);
 const hash=crypto.createHash('sha256').update(original).digest('hex');
 if(hash!=='62136e61de29bc1d2e6b4a1a8e58fd8cb25785baec0c61d0614ef7ad7f8fad35'||!original.includes(before))throw Error('Notifee subscriber changed; completion patch review required');
 return original.replace(before,after);
}
if(require.main===module){const file=path.resolve(__dirname,'..',target),source=fs.readFileSync(file,'utf8'),next=patch(source);if(next!==source)fs.writeFileSync(file,next);console.log('Notifee settings-change worker completion ready');}
module.exports={patch,target,before,after};
