const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const cache=new Map();function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>n.startsWith('./')?load(n.slice(2).replace(/\.ts$/,'')):require(n));cache.set(name,out);return out;}
function fixture(){const storage=new Map(),out={},account='axonic:1:'+'aa'.repeat(32),sender='axonic:1:'+'bb'.repeat(32),id='cc'.repeat(32),group='dd'.repeat(32);
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootNotificationRoute.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>n.includes('async-storage')?{default:{getItem:async k=>storage.get(k)??null,setItem:async(k,v)=>storage.set(k,v),removeItem:async k=>storage.delete(k)}}:n==='./rootChatActions'?load('rootChatActions'):{validAccountId:v=>typeof v==='string'&&/^axonic:1:[a-f0-9]{64}$/.test(v)});
 return {out,account,sender,id,group,data:{type:'root_neuron_message',account,sender,messageId:id},save:state=>storage.set('@axonic_root_chat_v1:'+account,JSON.stringify({version:1,messages:[],...state}))};}
test('generic wake opens the inbox until its actual unread conversation is known',async()=>{
 const f=fixture();await f.out.queueRootNotificationOpen(f.data);assert.equal((await f.out.pendingRootNotificationOpen(f.account)).inbox,true);
 const m={id:f.id,peer:f.sender,direction:'incoming'};f.save({messages:[m]});assert.equal((await f.out.pendingRootNotificationOpen(f.account)).inbox,undefined);
 f.save({messages:[{...m,group:{id:f.group}}],groups:[{id:f.group}]});assert.equal((await f.out.pendingRootNotificationOpen(f.account)).group,f.group);
 for(const patch of [{read:true},{deleted:true},{group:{id:f.group}}]){f.save({messages:[{...m,...patch}]});assert.equal((await f.out.pendingRootNotificationOpen(f.account)).inbox,true);}
 assert.equal(await f.out.pendingRootNotificationOpen(f.sender),null);
});
test('decrypted previews and in-app toasts retain their known conversation route',async()=>{
 const f=fixture();for(const data of [{...f.data,messageAt:'123',messagePreviews:'[]',group:f.group},{type:'root_neuron_message',account:f.account,sender:f.sender,group:f.group}]){
 await f.out.queueRootNotificationOpen(data);const target=await f.out.pendingRootNotificationOpen(f.account);assert.equal(target.group,f.group);assert.equal(target.hintId,undefined);}
 await f.out.finishRootNotificationOpen();assert.equal(await f.out.pendingRootNotificationOpen(f.account),null);
});

test('signed read and delete actions prevent stale hints from reopening a finished conversation',async()=>{
 for(const kind of ['read','delete']){const f=fixture(),m={id:f.id,peer:f.sender,direction:'incoming',text:'test',at:1,status:'delivered'};
 f.save({messages:[m],actions:[{id:'ee'.repeat(32),peer:f.sender,direction:kind==='read'?'outgoing':'incoming',kind,target:{id:f.id,author:f.sender},revision:1,text:'',at:2,status:'delivered'}]});
 await f.out.queueRootNotificationOpen(f.data);assert.equal((await f.out.pendingRootNotificationOpen(f.account)).inbox,true);}
});

test('a deleted group message resolves to the inbox rather than its sender private chat',async()=>{
 const f=fixture(),shared='ff'.repeat(32),group={id:f.group,revision:1,messageId:shared};
 f.save({messages:[{id:f.id,peer:f.sender,direction:'incoming',group,text:'test',at:1,status:'delivered'}],groups:[{id:f.group}],groupActions:[{id:'ee'.repeat(32),peer:f.sender,direction:'incoming',group,kind:'delete',target:{id:shared,author:f.sender},revision:1,text:'',at:2,status:'delivered'}]});
 await f.out.queueRootNotificationOpen(f.data);assert.equal((await f.out.pendingRootNotificationOpen(f.account)).inbox,true);
});
