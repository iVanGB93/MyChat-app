const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(){
 const account='axonic:1:'+'a'.repeat(64),sender='axonic:1:'+'b'.repeat(64),id='c'.repeat(64),storage=new Map(),calls=[],cancelled=[];
 let status={state:'unlocked',account},random=0,failSave=false,queued=0;
 const state={version:1,contacts:[{account:sender,accepted:true,blocked:false}],messages:[{id,peer:sender,direction:'incoming',text:'hello',status:'delivered'}]};
 const ledger={snapshot:async()=>state,enqueue:async(...args)=>calls.push(['reply',...args]),act:async(...args)=>calls.push(['read',...args]),enqueueGroup:async(...args)=>calls.push(['group',...args]),markGroupRead:async(...args)=>calls.push(['group-read',...args])};
 const imports={
  'react-native':{AppState:{currentState:'active'}},
  '@react-native-async-storage/async-storage':{default:{getItem:async key=>storage.get(key)??null,setItem:async(key,value)=>{if(failSave&&JSON.parse(value).rows[0].done)throw Error('disk unavailable');storage.set(key,value);}}},
  '@notifee/react-native':{default:{cancelNotification:async id=>cancelled.push(id)}},
  '../../../modules/axonic-nearby':{default:{identityRandomBytes:async()=>String(++random).padStart(64,'0')}},
  './localAccount':{localAccount:{status:()=>status,inspect:async()=>{}},localAccountSession:{initialize:async()=>{}}},
  './localRootChat':{localRootChat:()=>ledger},
  './localAccountNetwork':{startLocalAccountNetwork:()=>({stop(){}})},
  './rootChatActions':{rootChatView:(_,s)=>s},
  './rootNotificationRoute':{rootNotificationTarget:d=>d?.type==='root_neuron_message'&&d.account===account&&d.sender===sender?{account,sender,...(d.group?{group:d.group}:{})}:null,queueRootNotificationOpen:async()=>{queued++;}},
 };
 const mod={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootNotificationActions.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod,n=>{if(!imports[n])throw Error(n);return imports[n];});
 return {mod,state,storage,calls,cancelled,data:{type:'root_neuron_message',account,sender,messageId:id},setStatus:s=>status=s,failSave:v=>failSave=v,queued:()=>queued,account,sender};
}
test('notification reply is durably queued once with the original reply reference',async()=>{
 const f=fixture();await Promise.all([f.mod.handleRootNotificationAction('root-reply',f.data,'Hello'),f.mod.handleRootNotificationAction('root-reply',f.data,'Hello')]);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][1],f.sender);assert.equal(f.calls[0][3],'Hello');assert.deepEqual(f.calls[0][4],{id:f.data.messageId,author:f.sender});assert.equal(f.cancelled.length,1);
});
test('an interrupted action retains its ID so replay cannot create a second message',async()=>{
 const f=fixture();f.failSave(true);await assert.rejects(()=>f.mod.handleRootNotificationAction('root-reply',f.data,'Original'));f.failSave(false);await f.mod.handleRootNotificationAction('root-reply',f.data,'Changed');
 assert.equal(f.calls.length,2);assert.equal(f.calls[0][2],f.calls[1][2]);assert.equal(f.calls[1][3],'Original');
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
test('group replies use the group message ID and require current group membership',async()=>{
 const f=fixture(),group='e'.repeat(64),original='f'.repeat(64);f.data.group=group;f.state.messages[0].group={id:group,messageId:original};f.state.groups=[{id:group,accepted:true,blocked:false,members:[f.account,f.sender]}];
 await f.mod.handleRootNotificationAction('root-reply',f.data,'Group reply');assert.equal(f.calls[0][0],'group');assert.deepEqual(f.calls[0][4],{id:original,author:f.sender});
 const no=fixture();no.data.group=group;no.state.messages[0].group={id:group,messageId:original};no.state.groups=[{id:group,accepted:true,blocked:false,members:[no.sender]}];await no.mod.handleRootNotificationAction('root-reply',no.data,'No');assert.equal(no.calls.length,0);
});
