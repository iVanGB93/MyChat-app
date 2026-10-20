package com.axonic

import android.app.Instrumentation
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.os.SystemClock
import java.util.UUID
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

/** Dev-only real WorkManager regression. No permission change, messages, cancel,
 * prune, reset or database deletion. Completed test records remain in WorkManager. */
class NotificationBlockWorkInstrumentation : Instrumentation() {
  override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
  private fun foreground(): Boolean {
    val method=Class.forName("io.invertase.notifee.NotifeeReactUtils").getDeclaredMethod("isAppInForeground")
    method.isAccessible=true
    return method.invoke(null) as Boolean
  }
  private fun awaitForeground(expected: Boolean) {
    val until=SystemClock.elapsedRealtime()+15000
    while(foreground()!=expected && SystemClock.elapsedRealtime()<until) SystemClock.sleep(100)
    check(foreground()==expected) { "Unexpected app foreground state" }
  }
  private fun job(): String {
    val dataBuilder=Class.forName("androidx.work.Data\$Builder").getConstructor().newInstance()
    val dc=dataBuilder.javaClass
    dc.getMethod("putString",String::class.java,String::class.java).invoke(dataBuilder,"workType","app.notifee.core.BlockStateBroadcastReceiver.WORKER")
    dc.getMethod("putInt",String::class.java,Int::class.javaPrimitiveType).invoke(dataBuilder,"type",4)
    dc.getMethod("putBoolean",String::class.java,Boolean::class.javaPrimitiveType).invoke(dataBuilder,"blocked",false)
    val data=dc.getMethod("build").invoke(dataBuilder)
    val builder=Class.forName("androidx.work.OneTimeWorkRequest\$Builder").getConstructor(Class::class.java).newInstance(Class.forName("app.notifee.core.Worker"))
    builder.javaClass.getMethod("setInputData",Class.forName("androidx.work.Data")).invoke(builder,data)
    val request=builder.javaClass.getMethod("build").invoke(builder)
    val id=request.javaClass.getMethod("getId").invoke(request) as UUID
    val wmClass=Class.forName("androidx.work.WorkManager")
    val wm=wmClass.getMethod("getInstance",Context::class.java).invoke(null,targetContext)
    val began=SystemClock.elapsedRealtime()
    wmClass.getMethod("enqueue",Class.forName("androidx.work.WorkRequest")).invoke(wm,request)
    var state="UNKNOWN"
    while(SystemClock.elapsedRealtime()-began<20000) {
      val future=wmClass.getMethod("getWorkInfoById",UUID::class.java).invoke(wm,id) as Future<*>
      val info=future.get(3,TimeUnit.SECONDS)
      state=info?.javaClass?.getMethod("getState")?.invoke(info)?.toString() ?: "UNKNOWN"
      if(state in listOf("SUCCEEDED","FAILED","CANCELLED")) break
      SystemClock.sleep(100)
    }
    check(state=="SUCCEEDED") { "Settings worker $id left in $state" }
    return "$id:$state:${SystemClock.elapsedRealtime()-began}ms"
  }
  override fun onStart() {
    val result=Bundle()
    try {
      check(targetContext.packageName=="com.axonic.dev" && targetContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) { "Dev package required" }
      targetContext.startActivity(targetContext.packageManager.getLaunchIntentForPackage("com.axonic.dev")!!.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      awaitForeground(true)
      result.putString("foregroundWorker",job())
      targetContext.startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      awaitForeground(false)
      result.putString("backgroundWorker",job())
      result.putString("scope","Only two new settings-observation jobs; no OS settings changed; no data cleared")
      finish(-1,result)
    } catch(error: Throwable) {
      result.putString("failure",error.toString());finish(0,result)
    }
  }
}
