// Explicit local Dev-only notification fixtures; no network sends or chat writes.
const fs=require('node:fs'),ts=require('typescript');
const WebSocket=require('ws');
function evaluate(target,expression){return new Promise((resolve,reject)=>{
 const socket=new WebSocket(target.webSocketDebuggerUrl),timer=setTimeout(()=>{socket.close();reject(Error('Dev debugger timeout'));},25000);
 socket.on('open',()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}})));
 socket.on('error',error=>{clearTimeout(timer);reject(error);});
 socket.on('message',raw=>{const message=JSON.parse(raw);if(message.id!==1)return;clearTimeout(timer);socket.close();if(message.result?.exceptionDetails)reject(Error(JSON.stringify(message.result.exceptionDetails)));else resolve(message.result?.result?.value);});
 });}
async function run(target,code){
 const getter="const get=name=>__r([...__r.getModules()].find(([id,m])=>m.verboseName===name)[0]);";
 await evaluate(target,`(()=>{${getter}globalThis.__notificationTest={pending:true};Promise.resolve().then(()=>{${code}}).then(value=>globalThis.__notificationTest={value},error=>globalThis.__notificationTest={error:String(error)});return true})()`);
 try{for(let i=0;i<200;i++){await new Promise(resolve=>setTimeout(resolve,100));const state=await evaluate(target,'globalThis.__notificationTest');if(state&&!state.pending){if(state.error)throw Error(state.error);return state.value;}}throw Error('Device test timeout');}
 finally{await evaluate(target,'delete globalThis.__notificationTest').catch(()=>{});}
}
const transpile=source=>ts.transpileModule(source,{compilerOptions:{module:1,target:1,downlevelIteration:true}}).outputText;
async function main(){
 const targets=await(await fetch('http://127.0.0.1:8081/json/list')).json();
 const target=targets.find(t=>t.appId==='com.axonic.dev');if(!target)throw Error('Connected Axonic Dev required');
 const source=transpile(fs.readFileSync('src/services/identity/rootMessageWake.ts','utf8'));
 const code=`return (async()=>{
  const native=get('modules/axonic-nearby/index.ts').default;
  const find=pattern=>{const found=[...__r.getModules()].find(([id,m])=>pattern.test(m.verboseName));if(!found)throw Error('Module unavailable '+pattern);return __r(found[0]);};
  const nf=find(/@notifee.*[\\/]index\\.(ts|js)$/),notifee=nf.default;
  const sql=find(/expo-sqlite[\\/]build[\\/]index\\.js$/);
  const rn=find(/react-native[\\/]index\\.js$/);
  const p=get('src/services/identity/identityProtocol.ts'),c=get('src/services/identity/custodyProtocol.ts');
  const seed=n=>new Uint8Array(32).fill(n),now=Date.now();
  const sender=p.issueRecord(seed(1),[p.publicDevice(seed(2),seed(3))],now),recipient=p.issueRecord(seed(4),[p.publicDevice(seed(5),seed(6))],now),device=recipient.devices[0].id;
  const envelope=await c.sealCustody({record:sender,signingSeed:seed(2),encryptionSeed:seed(3),recipient,recipientDevice:device,id:'da'.repeat(32),text:'[DEV TEST] metadata',now,random:async n=>new Uint8Array(n).fill(12)});
  const data=c.createCustodyWake(envelope,sender),dbName='notification-progress-test-'+Date.now()+'.db',database=await sql.openDatabaseAsync(dbName);
  const notices=new Map(),shown=[];let origin=Date.now(),received=false;
  const fakeNotifee={...notifee,getChannel:async()=>null,createChannel:async()=>notifee.createChannel({id:'axonic-dev-notification-test',name:'Dev notification tests',importance:4}),
   displayNotification:async n=>{n.android.channelId='axonic-dev-notification-test';shown.push({at:Date.now()-origin,body:n.body,id:n.id,quiet:n.android.onlyAlertOnce===true});notices.set(n.id,n);await notifee.displayNotification(n);},
   getDisplayedNotifications:async()=>[...notices.values()].map(notification=>({notification})),cancelNotification:async id=>{notices.delete(id);await notifee.cancelNotification(id);}};
  const deps={
   '../mobileDeliveryDiagnostics':{deliveryDiagnosticEvent:()=>{}},
   './messageNotificationDeadline':get('src/services/identity/messageNotificationDeadline.ts'),
   './rootMessageToast':{publishRootMessageToast:()=>false},
   './rootNotificationPreferences':{readRootNotificationPreferences:async()=>({messages:true,sound:false})},
   './localAccount':{localAccount:{status:()=>({state:'unlocked',account:recipient.account})}},
   '../../../modules/axonic-nearby':{default:native},'./rootNotificationRoute':{rootConversationVisible:()=>false},
   '@react-native-async-storage/async-storage':{default:{getItem:async()=>JSON.stringify({version:1,contacts:[],messages:received?[{id:envelope.id,peer:sender.account,direction:'incoming'}]:[]})}},
   'expo-sqlite':{openDatabaseAsync:async()=>database},'react-native':{AppState:rn.AppState},
   '@notifee/react-native':{...nf,default:fakeNotifee},'./identityProtocol':p,'./custodyProtocol':c,
   './identityRecordStore':{createMobileIdentityRecordStore:()=>({read:async()=>sender})},
   './rootCallWake':{rootWakeContext:async()=>({account:recipient.account,device}),rootWakeBlocked:async()=>false},
  };
  const notification={};new Function('exports','require',${JSON.stringify(transpile(fs.readFileSync('src/services/identity/rootMessageNotification.ts','utf8')))})(notification,n=>deps[n]);deps['./rootMessageNotification']=notification;
  const mod={};new Function('exports','require',${JSON.stringify(source)})(mod,n=>{if(!deps[n])throw Error('Missing fixture dependency '+n);return deps[n];});
  const wait=async ms=>{const until=Date.now()+ms;while(Date.now()<until)await native.axonMessageWait(Math.max(1,Math.min(500,until-Date.now())));};
  async function reset(){for(const id of notices.keys())await notifee.cancelNotification(id);notices.clear();shown.length=0;received=false;await database.execAsync('DELETE FROM notices');origin=Date.now();}
  const results=[];
  try{
   if(rn.AppState.currentState==='active')throw Error('Put Dev in background before test');
   // A stalled retrieval must produce one fallback after inactivity.
   let release;const stalled=new Promise(r=>release=r);const capture=fakeNotifee.displayNotification;
   fakeNotifee.displayNotification=async n=>{await capture(n);release();};
   await mod.receiveRootMessageWake(data,()=>stalled);fakeNotifee.displayNotification=capture;
   results.push({scenario:'stalled',events:[...shown]});await reset();
   // One new authenticated milestone extends the window past the idle deadline.
   await mod.receiveRootMessageWake(data,async(a,s,id,e,progress)=>{await wait(2200);progress('connected:fixture');await wait(1800);received=true;await mod.finishRootMessageWake(a,s,id,{name:'[DEV TEST] Progress',text:'Preview after progress',at:Date.now()});});
   results.push({scenario:'progress',events:[...shown]});await reset();
   const preview=get('src/services/identity/rootNotificationPreviewText.ts').rootNotificationPreviewText;
   const message={text:'test.jpg',status:'pending',attachment:{mime:'image/jpeg',name:'test.jpg'}};
   await mod.finishRootMessageWake(recipient.account,sender.account,envelope.id,{name:'[DEV TEST] Media without download',text:preview(message),at:Date.now()});
   const osNotices=await notifee.getDisplayedNotifications();
   const osConfirmed=osNotices.some(n=>n.notification.id===shown[0]?.id&&n.notification.body==='Photo');
   results.push({scenario:'media-metadata-only',fileDownloaded:false,status:message.status,osConfirmed,events:[...shown]});
   await wait(1000);
   return results.map(r=>({...r,events:r.events.map(({id,...event})=>event)}));
  }finally{for(const id of notices.keys())await notifee.cancelNotification(id);await notifee.deleteChannel('axonic-dev-notification-test');await database.closeAsync();await sql.deleteDatabaseAsync(dbName);}
 })();`;
 const result=await run(target,transpile(code));
 console.log(JSON.stringify(result,null,2));
 if(result[0].events.length!==1||!result[0].events[0].body.includes('may have')||result[1].events.length!==1||result[1].events[0].body!=='Preview after progress'||result[2].events[0]?.body!=='Photo'||result[2].status!=='pending'||!result[2].osConfirmed)throw Error('Device notification assertion failed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
