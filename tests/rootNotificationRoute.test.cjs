const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const cache=new Map();function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>n.startsWith('./')?load(n.slice(2).replace(/\.ts$/,'')):require(n));cache.set(name,out);return out;}
function fixture(indexed,native={}){const storage=new Map(),out={},account='axonic:1:'+'aa'.repeat(32),sender='axonic:1:'+'bb'.repeat(32),id='cc'.repeat(32),group='dd'.repeat(32);
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootNotificationRoute.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>n==='../../modules/storage/chatStore'?{ownChatStore:owner=>({...(indexed?{indexed:typeof indexed==='function'?{readMessage:indexed}:indexed}:{}),read:async()=>{if(indexed)throw Error('Full history must not be read');return storage.get('@axonic_root_chat_v1:'+owner)??null;}})}:n.includes('async-storage')?{default:{getItem:async k=>storage.get(k)??null,setItem:async(k,v)=>storage.set(k,v),removeItem:async k=>storage.delete(k)}}:n.includes('/axonic-nearby')?{default:native}:n==='./rootChatActions'?load('rootChatActions'):n==='./rootMessageNotification'?{rootMessageNotificationId:()=> 'notice'}:{validAccountId:v=>typeof v==='string'&&/^axonic:1:[a-f0-9]{64}$/.test(v)});
 return {out,account,sender,id,group,data:{type:'root_neuron_message',account,sender,messageId:id},save:state=>storage.set('@axonic_root_chat_v1:'+account,JSON.stringify({version:1,messages:[],...state}))};}
test('generic wake opens the inbox until its actual unread conversation is known',async()=>{
 const f=fixture();await f.out.queueRootNotificationOpen(f.data);assert.equal((await f.out.pendingRootNotificationOpen(f.account)).inbox,true);
 const m={id:f.id,peer:f.sender,direction:'incoming'};f.save({messages:[m]});assert.equal((await f.out.pendingRootNotificationOpen(f.account)).inbox,undefined);
 f.save({messages:[{...m,group:{id:f.group}}],groups:[{id:f.group}]});assert.equal((await f.out.pendingRootNotificationOpen(f.account)).group,f.group);
 f.save({messages:[{...m,read:true}]});assert.equal((await f.out.pendingRootNotificationOpen(f.account)).inbox,undefined);
 for(const patch of [{deleted:true},{group:{id:f.group}}]){f.save({messages:[{...m,...patch}]});assert.equal((await f.out.pendingRootNotificationOpen(f.account)).inbox,true);}
 assert.equal(await f.out.pendingRootNotificationOpen(f.sender),null);
});
test('decrypted previews and in-app toasts retain their known conversation route',async()=>{
 const f=fixture();f.save({groups:[{id:f.group}]});for(const data of [{...f.data,messageAt:'123',messagePreviews:'[]',group:f.group},{type:'root_neuron_message',account:f.account,sender:f.sender,group:f.group}]){
 await f.out.queueRootNotificationOpen(data);const target=await f.out.pendingRootNotificationOpen(f.account);assert.equal(target.group,f.group);assert.equal(target.hintId,undefined);}
 await f.out.finishRootNotificationOpen();assert.equal(await f.out.pendingRootNotificationOpen(f.account),null);
});

test('read messages retain their conversation route while deleted messages explain their absence',async()=>{
 for(const kind of ['read','delete']){const f=fixture(),m={id:f.id,peer:f.sender,direction:'incoming',text:'test',at:1,status:'delivered'};
 f.save({messages:[m],actions:[{id:'ee'.repeat(32),peer:f.sender,direction:kind==='read'?'outgoing':'incoming',kind,target:{id:f.id,author:f.sender},revision:1,text:'',at:2,status:'delivered'}]});
 await f.out.queueRootNotificationOpen(f.data);assert.equal((await f.out.pendingRootNotificationOpen(f.account)).inbox,kind==='delete'?true:undefined);}
});

test('a deleted group message resolves to the inbox rather than its sender private chat',async()=>{
 const f=fixture(),shared='ff'.repeat(32),group={id:f.group,revision:1,messageId:shared};
 f.save({messages:[{id:f.id,peer:f.sender,direction:'incoming',group,text:'test',at:1,status:'delivered'}],groups:[{id:f.group}],groupActions:[{id:'ee'.repeat(32),peer:f.sender,direction:'incoming',group,kind:'delete',target:{id:shared,author:f.sender},revision:1,text:'',at:2,status:'delivered'}]});
 await f.out.queueRootNotificationOpen(f.data);assert.equal((await f.out.pendingRootNotificationOpen(f.account)).inbox,true);
});
test('queue events follow persistence and consuming an older target preserves the newer tap',async()=>{
 const f=fixture();let events=0;const off=f.out.subscribeRootNotificationOpen(()=>events++);
 await f.out.queueRootNotificationOpen(f.data);assert.equal(events,1);const first=await f.out.pendingRootNotificationOpen(f.account);
 await f.out.queueRootNotificationOpen({...f.data,messageId:'ee'.repeat(32)});await f.out.finishRootNotificationOpen(first);
 const next=await f.out.pendingRootNotificationOpen(f.account);assert.equal(next.hintId,'ee'.repeat(32));await f.out.finishRootNotificationOpen(next);assert.equal(await f.out.pendingRootNotificationOpen(f.account),null);
 off();await f.out.queueRootNotificationOpen(f.data);assert.equal(events,2);
});
test('a generic hint resolved to a group is consumed without leaving a stale navigation target',async()=>{
 const f=fixture();f.save({messages:[{id:f.id,peer:f.sender,direction:'incoming',group:{id:f.group}}],groups:[{id:f.group}]});
 await f.out.queueRootNotificationOpen(f.data);const target=await f.out.pendingRootNotificationOpen(f.account);assert.equal(target.group,f.group);
 await f.out.finishRootNotificationOpen(target);assert.equal(await f.out.pendingRootNotificationOpen(f.account),null);
});


test('generic FCM routing uses exact indexed lookup and does not fall back on storage errors',async()=>{
 let fail=false,calls=[];const f=fixture(async(peer,id)=>{calls.push([peer,id]);if(fail)throw Error('unavailable');return JSON.stringify({version:1,contacts:[],messages:[{id,peer,direction:'incoming',text:'test',at:1,status:'delivered'}]});});
 await f.out.queueRootNotificationOpen(f.data);assert.equal((await f.out.pendingRootNotificationOpen(f.account)).sender,f.sender);assert.deepEqual(calls,[[f.sender,f.id]]);fail=true;await assert.rejects(f.out.pendingRootNotificationOpen(f.account),/unavailable/);fail=false;assert.equal((await f.out.pendingRootNotificationOpen(f.account)).hintId,f.id);
});

test('decrypted private previews never read message history before routing',async()=>{
 const f=fixture(async()=>{throw Error('unrelated history blocked');});
 await f.out.queueRootNotificationOpen({...f.data,messageAt:'123',messagePreviews:'[]'});
 const target=await f.out.pendingRootNotificationOpen(f.account);assert.equal(target.sender,f.sender);assert.equal(target.inbox,undefined);
});

test('known group preview with missing local group opens inbox instead of sender private chat',async()=>{
 const f=fixture();f.save({groups:[]});await f.out.queueRootNotificationOpen({...f.data,messageAt:'123',group:f.group});
 const target=await f.out.pendingRootNotificationOpen(f.account);assert.equal(target.inbox,true);assert.equal(target.unavailable,'group_unknown');
});

test('known group preview uses the committed group check, with canonical fallback only when unavailable',async()=>{
 let result=true,fallbacks=0;
 const f=fixture({notificationGroupExists:async()=>result,readScope:async()=>{fallbacks++;return {raw:JSON.stringify({groups:[{id:f.group}]})};}});
 await f.out.queueRootNotificationOpen({...f.data,messageAt:'123',group:f.group});
 assert.equal((await f.out.pendingRootNotificationOpen(f.account)).group,f.group);
 result=false;assert.equal((await f.out.pendingRootNotificationOpen(f.account)).unavailable,'group_unknown');
 assert.equal(fallbacks,0);
 result=undefined;assert.equal((await f.out.pendingRootNotificationOpen(f.account)).inbox,undefined);
 assert.equal(fallbacks,1);
});
test('notification restoration cleanup cannot block destination routing',async()=>{
 let started=false,release;
 const cleanup=new Promise(resolve=>release=resolve),f=fixture(undefined,{forgetMessageNoticeRestore:()=>{started=true;return cleanup;}});
 try{
  await f.out.queueRootNotificationOpen({...f.data,messageAt:'123'});
  assert.equal(started,true);
  assert.equal((await f.out.pendingRootNotificationOpen(f.account)).sender,f.sender);
 }finally{release();}
});
