
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{DatabaseSync}=require('node:sqlite');
function fixture(){
 const database=new DatabaseSync(':memory:'),shown=[],cancelled=[];let owner=14,blocked=false,active='background';
 const sql={execAsync:async s=>database.exec(s),runAsync:async(s,...a)=>database.prepare(s).run(...a),getFirstAsync:async(s,...a)=>database.prepare(s).get(...a),getAllAsync:async(s,...a)=>database.prepare(s).all(...a),withExclusiveTransactionAsync:async f=>{database.exec('BEGIN');try{await f(sql);database.exec('COMMIT');}catch(e){database.exec('ROLLBACK');throw e;}}};
 const mods={ './neuronCallFeature':{neuronCallsEnabled:()=>true},
 'react-native':{AppState:{get currentState(){return active;}}},
 '@react-native-async-storage/async-storage':{default:{getItem:async key=>key==='@axonic_user_cache'?owner?JSON.stringify({id:owner}):null:key==='@axonic_neuron_call_wake_v1'?JSON.stringify({owner:14,account:'local',device:'device'}):JSON.stringify({state:{blockedIds:blocked?{18:true}:{}}}),setItem:async()=>{}}},
 'expo-sqlite':{openDatabaseAsync:async()=>sql},
 '@notifee/react-native':{default:{displayNotification:async n=>shown.push(n),cancelNotification:async id=>cancelled.push(id)},AndroidCategory:{CALL:'call'},AndroidImportance:{HIGH:4},AndroidVisibility:{PRIVATE:0},EventType:{ACTION_PRESS:2}},
 './identityRecordStore':{createMobileIdentityRecordStore:()=>({read:async()=>({account:'peer'})})},
 './chatIdentityPinStore':{createChatIdentityPinStore:()=>({read:async()=> 'peer'})},
 './callWakeProtocol':{callWakeSender:()=> 'peer',verifyCallWake:data=>JSON.stringify({callId:'a'.repeat(64),caller:'peer',kind:'invite',media:'voice',sequence:0,expiresAt:Date.now()+60000,...data})},
 '../localMessageStore':{getCachedRooms:async()=>[{room_type:'direct',members:[14,18],members_detail:[{id:18,username:'Test'}]}]},
 '../callNotificationChannel':{ensureCallChannel:async()=>{}},
 '../../store/appStore':{useAppStore:{getState:()=>({user:owner?{id:owner}:null,blockedIds:{}})}}};
 const out={};new Function('require','exports','__DEV__','process',ts.transpileModule(fs.readFileSync('src/services/identity/mobileCallWake.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>{assert.ok(mods[name],name);return mods[name];},out,true,{env:{EXPO_PUBLIC_AXONIC_CALL_CONTROL:'1'}});
 return {out,shown,cancelled,close:()=>database.close(),owner:n=>owner=n,block:()=>blocked=true,active:s=>active=s};
}
test('background wake persists once, displays one call notification and retains a replay tombstone',async t=>{
 const f=fixture();t.after(f.close);await f.out.receiveNeuronCallWake({});await f.out.receiveNeuronCallWake({});
 assert.equal(f.shown.length,1);assert.equal(f.shown[0].data.type,'neuron_call');assert.equal(f.shown[0].data.callId,undefined);
 assert.equal((await f.out.pendingCallWakes(14)).length,1);await f.out.finishCallWake(14,'a'.repeat(64));await f.out.receiveNeuronCallWake({});
 assert.equal(f.shown.length,1);assert.equal((await f.out.pendingCallWakes(14)).length,0);
});
test('a signed cancellation received first suppresses a late invitation',async t=>{
 const f=fixture();t.after(f.close);await f.out.receiveNeuronCallWake({kind:'cancel',sequence:2});await f.out.receiveNeuronCallWake({});
 assert.equal(f.shown.length,0);assert.equal(JSON.parse((await f.out.pendingCallWakes(14))[0].raw).kind,'cancel');
});
test('logout, account mismatch and local blocks prevent wake notification',async t=>{
 for(const change of [f=>f.owner(null),f=>f.owner(22),f=>f.block()]){const f=fixture();t.after(f.close);change(f);await f.out.receiveNeuronCallWake({});assert.equal(f.shown.length,0);}
});
test('decline is recorded locally and never interpreted as a legacy action',async t=>{
 const f=fixture();t.after(f.close);await f.out.receiveNeuronCallWake({});
 assert.equal(await f.out.handleNeuronCallNotification({type:2,detail:{notification:f.shown[0],pressAction:{id:'neuron-decline'}}}),true);
 assert.equal((await f.out.pendingCallWakes(14))[0].dismissed,1);
});
