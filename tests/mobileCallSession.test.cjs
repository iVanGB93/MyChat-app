const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function fixture(){let owner='a',params,lifecycle,resolveNotice,stops=0,pushStops=0,removed=0,confirmed=0,wakes=0;const runtime={recoverWakes:async()=>{},stop(){stops++;},coordinator:{snapshot:()=>({id:'call',status:'ringing',outgoing:false}),confirmRinging:async()=>confirmed++}},push={stop(){pushStops++;}};
 const deps={'../../modules/axonic-nearby':{default:{axonCallSetupWindow(){}}},'react-native':{AppState:{currentState:'active',addEventListener:(_n,f)=>{lifecycle=f;return{remove(){removed++;}};}}},'../services/identity/localAccount':{localAccount:{callDevice:()=> 'dev'}},'../services/identity/rootAccountCalls':{createRootAccountCalls:d=>{params=d;return runtime;}},'../services/identity/mobileCallJournalStore':{createMobileCallJournalStore:()=>({})},'../services/identity/rootPushRegistration':{startRootPushRegistration:()=>push},'../services/identity/rootCallWake':{registerRootCallWakeOwner:async()=>{},syncRootCallNotification:()=>new Promise(r=>resolveNotice=r)}};
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/composition/mobileCallSession.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>deps[n]??{},out);
 const session=out.createMobileCallSession('a',{owner:()=>owner,network:()=>({}),records:{},chat:async()=>({}),inboxChanged(){},wake(){wakes++;},activate:r=>assert.equal(r,runtime),changed(){}});
 return {session,params,event:()=>lifecycle(),notice:()=>resolveNotice(true),replace:()=>owner='b',counts:()=>({stops,pushStops,removed,confirmed,wakes})};}
test('mobile call session owns teardown once and refuses a late ringing confirmation after stop',async()=>{const f=fixture();f.event();f.session.stop();f.session.stop();f.notice();await new Promise(setImmediate);assert.deepEqual(f.counts(),{stops:1,pushStops:1,removed:1,confirmed:0,wakes:1});assert.equal(f.params.current(),false);f.event();assert.equal(f.counts().wakes,1);});
test('account replacement revokes mobile lifecycle and late notification completion',async()=>{const f=fixture();f.event();f.replace();f.notice();await new Promise(setImmediate);f.event();assert.equal(f.counts().confirmed,0);assert.equal(f.counts().wakes,1);assert.equal(f.params.current(),false);f.session.stop();});
test('mobile call session wires gateway discovery to the live network',()=>{
 let args;const deps={'../../modules/axonic-nearby':{default:{}},'react-native':{AppState:{addEventListener:()=>({remove(){}})}},'../services/identity/localAccount':{localAccount:{callDevice:()=> 'dev'}},'../services/identity/rootAccountCalls':{createRootAccountCalls:()=>({stop(){}})},'../services/identity/mobileCallJournalStore':{createMobileCallJournalStore:()=>({})},'../services/identity/rootPushRegistration':{startRootPushRegistration:(...a)=>{args=a;return {stop(){}};}},'../services/identity/rootCallWake':{registerRootCallWakeOwner:async()=>{}}};
 const e={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/composition/mobileCallSession.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>deps[n]??{},e);let peers=['second'];const network={pushPeers:()=>peers,pushRequest:(p,r)=>p+':'+r};const s=e.createMobileCallSession('a',{owner:()=> 'a',network:()=>network,records:{},chat:async()=>({}),inboxChanged(){},wake(){},activate(){},changed(){}});assert.deepEqual(args[2](),['second']);peers=['second','third'];assert.deepEqual(args[2](),peers);assert.equal(args[1]('third','register'),'third:register');s.stop();
});

test('production mobile adapter supplies fresh group membership when the release capability is enabled',async()=>{
 const source=ts.transpileModule(fs.readFileSync('src/composition/mobileCallSession.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText;
 for(const enabled of [true,false]){
  let params,reads=0,groups=[{id:'family',revision:1,members:['owner','peer'],accepted:true,blocked:false}];
  const deps={'../modules/calls/features':{GROUP_CALLS_ENABLED:enabled},'../../modules/axonic-nearby':{default:{}},'react-native':{AppState:{addEventListener:()=>({remove(){}})}},'../services/identity/localAccount':{localAccount:{callDevice:()=> 'dev'}},'../services/identity/rootAccountCalls':{createRootAccountCalls:d=>(params=d,{stop(){}})},'../services/identity/mobileCallJournalStore':{createMobileCallJournalStore:()=>({})},'../services/identity/rootPushRegistration':{startRootPushRegistration:()=>({stop(){}})},'../services/identity/rootCallWake':{registerRootCallWakeOwner:async()=>{}}};
  const out={};new Function('require','exports','__DEV__',source)(n=>deps[n]??{},out,false);
  const session=out.createMobileCallSession('owner',{owner:()=> 'owner',network:()=>({}),records:{},chat:async()=>{reads++;return {contacts:[],groups};},inboxChanged(){},wake(){},activate(){},changed(){}});
  assert.deepEqual(await params.groups(),enabled?groups:[]);
  groups=[{...groups[0],revision:2,members:['owner','new-peer']}];
  assert.deepEqual(await params.groups(),enabled?groups:[]);
  groups=undefined;assert.deepEqual(await params.groups(),[]);
  assert.equal(reads,enabled?3:0);session.stop();
 }
});
