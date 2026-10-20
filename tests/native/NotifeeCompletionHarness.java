// The test runner injects the exact patch body here. Android/React are replaced
// only at their event/timer boundary; both old and new completion behavior run.
public class NotifeeCompletionHarness {
  static boolean foreground;
  static final String KEY_HEADLESS="headless", NOTIFICATION_EVENT_KEY="notification";
  static boolean isAppInForeground() { return foreground; }
  static class EventMap { void putBoolean(String key, boolean value) {} }
  static class Event { int completions; void setCompletionResult() { completions++; } }
  interface Callback { void call(); }
  static class NotifeeReactUtils {
    static boolean throwsOnSend, throwsOnStart;
    static Callback callback;
    static long timeout;
    static void sendEvent(String key, EventMap map) { if(throwsOnSend)throw new IllegalStateException("send"); }
    static void startHeadlessTask(String key, EventMap map, long ms, Callback cb) {
      timeout=ms; callback=cb;
      if(throwsOnStart)throw new IllegalStateException("start");
    }
  }
  static void onBlockStateEvent(Event blockStateEvent) {
    EventMap eventMap=new EventMap();
    /* PATCH_BODY */
  }
  static void check(boolean ok,String name) { if(!ok)throw new AssertionError(name); }
  public static void main(String[] args) {
    foreground=true;Event e=new Event();onBlockStateEvent(e);
    if(args.length>0 && args[0].equals("baseline")) {
      check(e.completions==0,"original foreground leak must reproduce");
      System.out.println("Original foreground completion leak reproduced");return;
    }
    check(e.completions==1,"foreground completes");
    NotifeeReactUtils.throwsOnSend=true;e=new Event();
    try { onBlockStateEvent(e);throw new AssertionError("send should throw"); } catch(IllegalStateException expected) {}
    check(e.completions==1,"foreground exception completes");
    foreground=false;NotifeeReactUtils.throwsOnSend=false;e=new Event();onBlockStateEvent(e);
    check(NotifeeReactUtils.timeout==10000,"bounded RN task");
    check(android.os.Handler.delay==10000,"bounded native startup");
    NotifeeReactUtils.callback.call();check(e.completions==1,"background callback completes");
    check(android.os.Handler.pending==null,"callback removes timer");
    NotifeeReactUtils.callback.call();check(e.completions==1,"duplicate callback harmless");
    e=new Event();onBlockStateEvent(e);android.os.Handler.fire();check(e.completions==1,"stalled startup completes");
    NotifeeReactUtils.callback.call();check(e.completions==1,"late callback harmless");
    NotifeeReactUtils.throwsOnStart=true;e=new Event();
    try { onBlockStateEvent(e);throw new AssertionError("start should throw"); } catch(IllegalStateException expected) {}
    check(e.completions==1 && android.os.Handler.pending==null,"startup exception completes and removes timer");
    System.out.println("Completion, timeout and exactly-once assertions passed");
  }
}
