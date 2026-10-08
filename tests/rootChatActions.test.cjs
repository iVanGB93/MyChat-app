const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const cache=new Map();function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(p=>p.startsWith('./')?load(p.slice(2).replace(/\.(ts|js)$/,'')):require(p),out);cache.set(name,out);return out;}
const ledger=load('rootChatLedger'),actions=load('rootChatActions');
const a='axonic:1:'+'a'.repeat(64),b='axonic:1:'+'b'.repeat(64),c='axonic:1:'+'c'.repeat(64),id='1'.repeat(64);let next=20;
const fresh=()=> (++next).toString(16).padStart(64,'0');
function fixture(owner){let raw=null,fail=false,active=true;return {api:ledger.createRootChatLedger({owner,current:()=>active,now:()=>100000,read:async()=>raw,write:async v=>{if(fail)throw Error('disk');raw=v;}}),fail:()=>fail=true,lock:()=>active=false};}
async function pair(){const left=fixture(a),right=fixture(b);await left.api.enqueue(b,id,'Original');await right.api.receive(a,id,ledger.encodeRootChat(b,id,'Original'));return {left,right};}
async function exchange(from,to,sender){for(const pending of ledger.pendingRootChat(await from.api.snapshot())){assert.equal(await to.api.receive(sender,pending.id,pending.raw),true);await from.api.delivered(pending.peer,pending.id);}}
const view=async(f,owner)=>actions.rootChatView(owner,await f.api.snapshot()).messages[0];
test('edits preserve original retry payload, round-trip once, and use monotonically increasing revisions',async()=>{
 const {left,right}=await pair();const event=fresh();await left.api.act(b,event,{id,author:a},'edit','Edited');await left.api.act(b,event,{id,author:a},'edit','Edited');
 assert.equal((await left.api.snapshot()).actions.length,1);assert.equal((await left.api.snapshot()).messages[0].text,'Original');
 await exchange(left,right,a);assert.equal((await view(right,b)).text,'Edited');assert.equal((await view(right,b)).edited,true);
 await left.api.act(b,fresh(),{id,author:a},'edit','Latest');await exchange(left,right,a);assert.equal((await view(right,b)).text,'Latest');
 assert.equal(ledger.pendingRootChat(await left.api.snapshot()).length,0);
});
test('only the original author can edit/delete; changed action retries and unrelated targets fail',async()=>{
 const {left,right}=await pair();await assert.rejects(right.api.act(a,fresh(),{id,author:a},'edit','Forgery'));
 await assert.rejects(left.api.act(b,fresh(),{id,author:b},'delete'));
 const event={id:fresh(),peer:a,direction:'outgoing',target:{id,author:a},kind:'delete',revision:1,text:'',at:0,status:'pending'};
 assert.equal(await left.api.receive(b,event.id,actions.encodeRootAction(event)),false);
 await assert.rejects(left.api.act(c,fresh(),{id,author:a},'edit','Wrong chat'));
 const action=fresh();await left.api.act(b,action,{id,author:a},'edit','One');await assert.rejects(left.api.act(b,action,{id,author:a},'edit','Two'),/conflict/);
});
test('out-of-order edit/delete persists before original; deleted messages cannot reappear',async()=>{
 const left=fixture(a),right=fixture(b);await left.api.enqueue(b,id,'Original');await left.api.act(b,fresh(),{id,author:a},'edit','Edited');await left.api.act(b,fresh(),{id,author:a},'delete');
 const events=(await left.api.snapshot()).actions;
 for(const e of events.slice().reverse())assert.equal(await right.api.receive(a,e.id,actions.encodeRootAction(e)),true);
 assert.equal(await right.api.receive(a,id,ledger.encodeRootChat(b,id,'Original')),true);
 assert.equal((await view(right,b)).deleted,true);assert.equal((await view(right,b)).text,'Message deleted');
 await assert.rejects(left.api.act(b,fresh(),{id,author:a},'edit','Resurrect'),/deleted/);
});
test('reactions are independent per participant; removals do not erase the other choice',async()=>{
 const {left,right}=await pair();await left.api.act(b,fresh(),{id,author:a},'reaction','👍');await exchange(left,right,a);
 await right.api.act(a,fresh(),{id,author:a},'reaction','❤️');await exchange(right,left,b);
 assert.equal((await view(left,a)).reactions.length,2);await left.api.act(b,fresh(),{id,author:a},'reaction','');await exchange(left,right,a);
 assert.deepEqual((await view(right,b)).reactions,[{author:b,text:'❤️'}]);
 await assert.rejects(right.api.act(a,fresh(),{id,author:a},'reaction','arbitrary text'));
});
test('read acknowledgments can only come from recipient and repeated marking is idempotent',async()=>{
 const {left,right}=await pair();await assert.rejects(left.api.act(b,fresh(),{id,author:a},'read'));
 await right.api.act(a,fresh(),{id,author:a},'read');await right.api.act(a,fresh(),{id,author:a},'read');
 assert.equal((await right.api.snapshot()).actions.length,1);await exchange(right,left,b);assert.equal((await view(left,a)).read,true);
});
test('conflicting revision, blocked peer, disk failure, locked account and oversize event fail closed',async()=>{
 const {left,right}=await pair();await left.api.act(b,fresh(),{id,author:a},'edit','One');await exchange(left,right,a);
 const event={...(await left.api.snapshot()).actions[0],id:fresh(),text:'Conflict'};
 assert.equal(await right.api.receive(a,event.id,actions.encodeRootAction(event)),false);
 await left.api.configure(b,{blocked:true});await assert.rejects(left.api.act(b,fresh(),{id,author:a},'delete'),/blocked/);
 right.fail();await assert.rejects(right.api.act(a,fresh(),{id,author:a},'read'),/disk/);assert.equal((await right.api.snapshot()).actions.filter(a=>a.kind==='read').length,0);
 right.lock();await assert.rejects(right.api.act(a,fresh(),{id,author:a},'read'),/Unlock/);
 const f=fixture(a);await f.api.enqueue(b,id,'Hello');await assert.rejects(f.api.act(b,fresh(),{id,author:a},'edit','🙂'.repeat(401)));
});
