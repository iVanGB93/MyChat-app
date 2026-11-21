const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function fixture(){let owner='a',params,lifecycle,resolveNotice,stops=0,removed=0,confirmed=0,wakes=0;const runtime={recoverWakes:async()=>{},stop(){stops++;},coordinator:{snapshot:()=>({id:'call',status:'ringing',outgoing:false}),confirmRinging:async()=>confirmed++}};
 const deps={'../../modules/axonic-nearby':{default:{axonCallSetupWindow(){}}},'react-native':{AppState:{currentState:'active',addEventListener:(_n,f)=>{lifecycle=f;return{remove(){removed++;}};}}},'../services/identity/localAccount':{localAccount:{callDevice:()=> 'dev'}},'../services/identity/rootAccountCalls':{createRootAccountCalls:d=>{params=d;return runtime;}},'../services/identity/mobileCallJournalStore':{createMobileCallJournalStore:()=>({})},'../services/identity/rootCallWake':{registerRootCallWakeOwner:async()=>{},syncRootCallNotification:()=>new Promise(r=>resolveNotice=r)}};
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/composition/mobileCallSession.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>deps[n]??{},out);
 const session=out.createMobileCallSession('a',{owner:()=>owner,network:()=>({}),records:{},chat:async()=>({}),inboxChanged(){},wake(){wakes++;},activate:r=>assert.equal(r,runtime),changed(){}});
 return {session,params,event:()=>lifecycle(),notice:()=>resolveNotice(true),replace:()=>owner='b',counts:()=>({stops,removed,confirmed,wakes})};}
test('mobile call session owns teardown once and refuses a late ringing confirmation after stop',async()=>{const f=fixture();f.event();f.session.stop();f.session.stop();f.notice();await new Promise(setImmediate);assert.deepEqual(f.counts(),{stops:1,removed:1,confirmed:0,wakes:1});assert.equal(f.params.current(),false);f.event();assert.equal(f.counts().wakes,1);});
test('account replacement revokes mobile lifecycle and late notification completion',async()=>{const f=fixture();f.event();f.replace();f.notice();await new Promise(setImmediate);f.event();assert.equal(f.counts().confirmed,0);assert.equal(f.counts().wakes,1);assert.equal(f.params.current(),false);f.session.stop();});
test('network push registration follows gateway scope and stops when the account changes',()=>{
 const source=fs.readFileSync('src/composition/neuronRuntime.ts','utf8');
 const registration=source.match(/  let push:ReturnType<[\s\S]*?(?=  let calls:)/)?.[0];
 assert.ok(registration,'network registration lifecycle is present');
 const compiled=ts.transpileModule(registration+'\nreturn syncPushRegistration;', {compilerOptions:{target:9}}).outputText;
 let account='first-account',scope,peers=['first','second'];
 const sessions=[];
 const start=(current,request,gateways)=>{
  const session={current,request,gateways,connectedCount:0,stops:0,snapshot(){},
   connected(){this.connectedCount++;},stop(){this.stops++;}};
  sessions.push(session);
  return session;
 };
 const sync=new Function('owner','runtime','recoveryPeers','startRootPushRegistration','inspectPush',compiled)(
  ()=>account,{pushPeers:()=>peers,pushRequest:(peer,raw)=>[peer,raw]},()=>scope,start);
 sync();
 const first=sessions[0];
 assert.deepEqual(first.gateways(),['first','second']);
 scope=new Set(['second']);
 peers=['second','third'];
 sync();
 assert.equal(sessions.length,1);
 assert.equal(first.connectedCount,2);
 assert.deepEqual(first.gateways(),['second']);
 assert.deepEqual(first.request('second','register'),['second','register']);
 account='next-account';
 sync();
 assert.equal(first.stops,1);
 assert.equal(first.current(),false);
 const second=sessions[1];
 assert.equal(second.current(),true);
 account=null;
 sync();
 assert.equal(second.stops,1);
 assert.equal(second.current(),false);
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
