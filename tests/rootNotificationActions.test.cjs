const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(){
 const account='axonic:1:'+'a'.repeat(64),sender='axonic:1:'+'b'.repeat(64),id='c'.repeat(64),storage=new Map(),displayed=new Map(),calls=[],cancelled=[];
 let status={state:'unlocked',account},random=0,failSave=false,queued=0;
 const state={version:1,contacts:[{account:sender,accepted:true,blocked:false}],messages:[{id,peer:sender,direction:'incoming',text:'hello',status:'delivered',at:10}]};
 const ledger={snapshot:async()=>{throw Error('Notification must not read full history');},messageSnapshot:async(peer,message)=>{assert.equal(peer,sender);assert.equal(message,id);return state;},unreadSnapshot:async peers=>{assert.deepEqual(peers,[sender]);return state;},enqueue:async(...args)=>calls.push(['reply',...args]),act:async(...args)=>calls.push(['read',...args]),enqueueGroup:async(...args)=>calls.push(['group',...args]),markGroupRead:async(...args)=>calls.push(['group-read',...args]),readBatch:async(peer,items)=>{calls.push(['read-batch',peer,items.map(item=>item.target.id)]);for(const m of state.messages)if(items.some(item=>item.target.id===m.id))m.read=true;}};
 const imports={
  './rootCallNotificationAction':{queueRootCallNotificationAction:async(action)=>{calls.push(['call-action',action]);return true;},rootCallNotificationTarget:data=>data.type==='root_neuron_call'?{account:data.account,callId:id,expiresAt:100}:null},
  './rootCallWake':{rootWakeContext:async()=>({account}),dismissRootCallNotice:async id=>calls.push(['dismiss',id])},
  './messageWakeLease':{acquireMessageWakeLease:()=>{calls.push(['acquire']);return()=>calls.push(['release']);}},
  'react-native':{AppState:{currentState:'active'}},
  '@react-native-async-storage/async-storage':{default:{getItem:async key=>storage.get(key)??null,setItem:async(key,value)=>{if(failSave&&JSON.parse(value).rows[0].done)throw Error('disk unavailable');storage.set(key,value);}}},
  '@notifee/react-native':{default:{getDisplayedNotifications:async()=>[...displayed.values()].map(notification=>({notification})),cancelNotification:async id=>{cancelled.push(id);displayed.delete(id);}}},
  '../../../modules/axonic-nearby':{default:{identityRandomBytes:async()=>String(++random).padStart(64,'0')}},
  './localAccount':{startLocalAccount:async()=>{},localAccount:{status:()=>status,inspect:async()=>{}},localAccountSession:{initialize:async()=>{}}},
  './localRootChat':{localRootChat:()=>ledger},
  '../../composition/neuronRuntime':{startLocalAccountNetwork:()=>({async declineIncomingNotification(...args){calls.push(['decline',...args]);},stop(){}})},
  './rootChatActions':{rootChatView:(_,s)=>s},
  './rootNotificationRoute':{rootNotificationTarget:d=>d?.type==='root_neuron_message'&&d.account===account&&d.sender===sender?{account,sender,...(d.group?{group:d.group}:{})}:null,queueRootNotificationOpen:async()=>{queued++;}},
 };
 const notifications={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootMessageNotification.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(notifications,n=>imports[n]);imports['./rootMessageNotification']=notifications;
 const noticeId=notifications.rootMessageNotificationId(account,sender);displayed.set(noticeId,{id:noticeId,data:{sender,messageId:id}});
 const mod={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootNotificationActions.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod,n=>{if(!imports[n])throw Error(n);return imports[n];});
 return {mod,state,ledger,storage,displayed,calls,cancelled,data:{type:'root_neuron_message',account,sender,messageId:id},setStatus:s=>status=s,background:()=>{imports['react-native'].AppState.currentState='background';},failSave:v=>failSave=v,queued:()=>queued,account,sender};
}
test('a background decline dismisses the card before signaling and releases its wake lease',async()=>{
 const f=fixture(),data={type:'root_neuron_call',account:f.account};
 f.background();
 await f.mod.handleRootNotificationAction('root-call-decline',data);
 assert.deepEqual(f.calls.map(c=>c[0]),['call-action','dismiss','acquire','decline','release']);
 assert.equal(f.queued(),0);
});
test('locked accounts dismiss a matching decline without opening a window or signing',async()=>{
 const f=fixture();
 f.background();f.setStatus({state:'locked',account:f.account});
 await f.mod.handleRootNotificationAction('root-call-decline',{type:'root_neuron_call',account:f.account});
 await f.mod.handleRootNotificationAction('root-call-decline',{type:'root_neuron_call',account:f.sender});
 assert.deepEqual(f.calls.map(c=>c[0]),['call-action','dismiss']);
 assert.equal(f.queued(),0);
});
test('a foreground decline uses the visible call screen without a headless wake',async()=>{
 const f=fixture();
 await f.mod.handleRootNotificationAction('root-call-decline',{type:'root_neuron_call',account:f.account});
 assert.deepEqual(f.calls.map(c=>c[0]),['call-action','dismiss']);
});
test('notification reply is durably queued once with the original reply reference',async()=>{
 const f=fixture();await Promise.all([f.mod.handleRootNotificationAction('root-reply',f.data,'Hello'),f.mod.handleRootNotificationAction('root-reply',f.data,'Hello')]);
 assert.equal(f.calls.length,2);assert.equal(f.calls[0][1],f.sender);assert.equal(f.calls[0][3],'Hello');assert.deepEqual(f.calls[0][4],{id:f.data.messageId,author:f.sender});assert.deepEqual(f.calls[1],['read-batch',f.sender,[f.data.messageId]]);assert.equal(f.cancelled.length,1);
});
test('an interrupted action retains its ID so replay cannot create a second message',async()=>{
 const f=fixture();f.failSave(true);await assert.rejects(()=>f.mod.handleRootNotificationAction('root-reply',f.data,'Original'));f.failSave(false);await f.mod.handleRootNotificationAction('root-reply',f.data,'Changed');
 assert.deepEqual(f.calls.map(c=>c[0]),['reply','read-batch','reply']);assert.equal(f.calls[0][2],f.calls[2][2]);assert.equal(f.calls[2][3],'Original');
});
test('reply reads earlier messages, preserves newer messages and waits for a successful enqueue',async()=>{
 const f=fixture(),target=f.state.messages[0],earlier={...target,id:'d'.repeat(64),at:9},later={...target,id:'e'.repeat(64),at:11};
 f.state.messages.push(earlier,later,{...target,id:'f'.repeat(64),at:9,group:{id:'group'}});
 const enqueue=f.ledger.enqueue;f.ledger.enqueue=async()=>{throw Error('queue unavailable');};
 await assert.rejects(f.mod.handleRootNotificationAction('root-reply',f.data,'Reply'),/queue unavailable/);
 assert.deepEqual(f.calls,[]);assert.equal(f.cancelled.length,0);
 f.ledger.enqueue=enqueue;
 for(const notice of f.displayed.values())notice.data.messageId=later.id;
 await f.mod.handleRootNotificationAction('root-reply',f.data,'Reply');
 assert.deepEqual(f.calls[1],['read-batch',f.sender,[target.id,earlier.id]]);
 assert.equal(later.read,undefined);assert.equal(f.cancelled.length,0);
});
test('locked, changed-owner, blocked, unaccepted and unknown-message actions cannot send',async()=>{
 for(const configure of [f=>f.setStatus({state:'locked',account:f.account}),f=>f.setStatus({state:'unlocked',account:'axonic:1:'+'d'.repeat(64)}),f=>f.state.contacts[0].blocked=true,f=>f.state.contacts[0].accepted=false,f=>f.state.messages=[]]){
  const f=fixture();configure(f);await f.mod.handleRootNotificationAction('root-reply',f.data,'Private');assert.equal(f.calls.length,0);assert.equal(f.storage.size,0);
 }
});
test('mark as read sends the original message receipt once without fabricating a reply',async()=>{
 const f=fixture();await f.mod.handleRootNotificationAction('root-mark-read',f.data);await f.mod.handleRootNotificationAction('root-mark-read',f.data);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'read');assert.equal(f.calls[0][4],'read');
});

test('mark as read dismisses only the acted-on notification and preserves other cards',async()=>{
 const f=fixture(),other='root-conversation:'+f.account+':direct:another-test-peer';
 f.displayed.set(other,{id:other,data:{sender:'another-test-peer',messageId:'e'.repeat(64)}});
 await f.mod.handleRootNotificationAction('root-mark-read',f.data);
 assert.equal(f.cancelled.length,1);assert.equal(f.displayed.size,1);assert(f.displayed.has(other));
});
test('group replies use the group message ID and require current group membership',async()=>{
 const f=fixture(),group='e'.repeat(64),original='f'.repeat(64);f.data.group=group;f.state.messages[0].group={id:group,messageId:original};f.state.groups=[{id:group,accepted:true,blocked:false,members:[f.account,f.sender]}];
 await f.mod.handleRootNotificationAction('root-reply',f.data,'Group reply');assert.equal(f.calls[0][0],'group');assert.deepEqual(f.calls[0][4],{id:original,author:f.sender});assert.deepEqual(f.calls[1],['group-read',group,10]);
 const no=fixture();no.data.group=group;no.state.messages[0].group={id:group,messageId:original};no.state.groups=[{id:group,accepted:true,blocked:false,members:[no.sender]}];await no.mod.handleRootNotificationAction('root-reply',no.data,'No');assert.equal(no.calls.length,0);
});

test('acting on an older notification leaves the newer conversation notification visible',async()=>{
 const f=fixture();for(const notice of f.displayed.values())notice.data.messageId='d'.repeat(64);
 await f.mod.handleRootNotificationAction('root-mark-read',f.data);
 assert.equal(f.calls.length,1);assert.equal(f.cancelled.length,0);assert.equal(f.displayed.size,1);
});
