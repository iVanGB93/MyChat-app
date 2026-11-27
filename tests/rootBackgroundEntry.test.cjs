const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture({active=false,accepted=true,current=true}={}){
 const calls=[],tasks={};let receiver,release;const pending=new Promise(r=>release=r);
 const imports={
  'react-native':{AppState:{currentState:active?'active':'background'},AppRegistry:{registerHeadlessTask:(n,f)=>tasks[n]=f()}},
  '../../../modules/axonic-nearby':{default:{messageRecoveryEnqueue:(raw,high)=>{calls.push(['enqueue',JSON.parse(raw),high]);return accepted;},messageRecoveryCurrent:()=>current,messageRecoveryComplete:t=>calls.push(['complete',t])}},
  '../diagnosticJournal':{diagnosticJournal:{record:()=>{}}},'./pushDeliveryObservation':{pushDeliveryObservation:()=>({})},
  '@react-native-firebase/messaging':{getMessaging:()=>({}),setBackgroundMessageHandler:(_,f)=>receiver=f,onMessage:()=>{}},
  '@notifee/react-native':{default:{onBackgroundEvent:()=>{}},EventType:{}},
  './rootMessageRecovery':{recoverRootMessage:(...args)=>{calls.push(['recover',args]);return pending;}},
  './mobileWakeSenderRecovery':{recoverWakeSender:()=>{}},'./rootNotificationRoute':{},
  './rootCallWake':{receiveRootCallWake:()=>calls.push(['call'])},
  './rootMessageWake':{receiveRootMessageWake:async(_,recover)=>{calls.push(['verify']);await recover('owner','peer','id',1000,undefined,undefined,undefined,undefined);},rootMessageWakeFailed:()=>calls.push(['invalid'])},
  './rootNotificationActions':{}
 };
 const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootBackgroundEntry.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>imports[n]);out.registerRootBackgroundHandlers();
 return {calls,tasks,receive:message=>receiver(message),release};
}
const message={data:{type:'neuron_message'},sentTime:123,priority:1};
test('background push hands off before verification and retains provider timing and priority',async()=>{const f=fixture();await f.receive(message);assert.deepEqual(f.calls,[['enqueue',message,true]]);});
test('job completion waits for verified recovery and passes its cancellation token',async()=>{const f=fixture();let done=false;const work=f.tasks.AxonicMessageRecovery({message:JSON.stringify(message),token:'job',queuedAt:Date.now()}).then(()=>done=true);await Promise.resolve();assert.equal(done,false);assert.equal(f.calls.find(x=>x[0]==='recover')[1][8],'job');assert(!f.calls.some(x=>x[0]==='complete'));f.release();await work;assert.deepEqual(f.calls.at(-1),['complete','job']);});
test('cancelled and malformed job input never bypass verification; cleanup still happens',async()=>{for(const current of [false,true]){const f=fixture({current});await f.tasks.AxonicMessageRecovery({message:'invalid',token:'job',queuedAt:0}).catch(()=>{});assert(!f.calls.some(x=>x[0]==='recover'));assert.deepEqual(f.calls.at(-1),['complete','job']);}});
test('foreground, calls and rejected job admission retain existing handlers',async()=>{for(const options of [{active:true},{accepted:false}]){const f=fixture(options);f.release();await f.receive(message);assert(f.calls.some(x=>x[0]==='verify'));}const f=fixture();await f.receive({data:{type:'call'}});assert.deepEqual(f.calls,[['call']]);});
