const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function fixture(){let saved=null,requests=0,status=0,fail=false;const app={currentState:'active'},mod={};
 const deps={'react-native':{AppState:app},'@notifee/react-native':{AuthorizationStatus:{AUTHORIZED:1},default:{getNotificationSettings:async()=>({authorizationStatus:status}),requestPermission:async()=>{requests++;if(fail)throw Error('not ready');}}},'@react-native-async-storage/async-storage':{default:{getItem:async()=>saved,setItem:async(k,v)=>{saved=v;}}}};
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/notificationPermission.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod,n=>deps[n]);
 return {ask:mod.requestInitialNotificationPermission,app,requests:()=>requests,status:v=>status=v,fail:v=>fail=v};
}
test('first foreground launch asks once even concurrently, and does not repeat a denial',async()=>{
 const f=fixture();f.app.currentState='background';await f.ask();assert.equal(f.requests(),0);
 f.app.currentState='active';await Promise.all([f.ask(),f.ask()]);assert.equal(f.requests(),1);await f.ask();assert.equal(f.requests(),1);
});
test('already authorized users avoid prompts and transient failures can retry',async()=>{
 const granted=fixture();granted.status(1);await granted.ask();assert.equal(granted.requests(),0);
 const f=fixture();f.fail(true);await assert.rejects(f.ask());f.fail(false);await f.ask();assert.equal(f.requests(),2);await f.ask();assert.equal(f.requests(),2);
});
