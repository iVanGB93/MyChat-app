package android.os;
public class Handler {
  public static Runnable pending;
  public static long delay;
  public Handler(Looper looper) {}
  public boolean postDelayed(Runnable r,long ms) { pending=r;delay=ms;return true; }
  public void removeCallbacks(Runnable r) { if(pending==r)pending=null; }
  public static void fire() { Runnable r=pending;pending=null;if(r!=null)r.run(); }
}
