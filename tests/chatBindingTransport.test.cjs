const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const cache=new Map();
function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync(`src/services/identity/${name}.ts`,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(p=>p.startsWith('./')?load(p.slice(2).replace(/\.ts$/,'')):require(p),out);cache.set(name,out);return out;}
const identity=load('identityProtocol'),binding=load('chatIdentityBinding'),{createChatBindingTransport}=load('chatBindingTransport');
const now=1800000000000,room='22222222-2222-4222-8222-222222222222';
function fixture(){
 const nodes=[14,18].map(user=>{
  const key=new Uint8Array(crypto.randomBytes(32)),device=identity.publicDevice(key,new Uint8Array(crypto.randomBytes(32)));
  const record=identity.issueRecord(new Uint8Array(crypto.randomBytes(32)),[device],now),pins=new Map(),frames=[];
  let active=true,blocked=false,signs=0;
  const authorized=(r,p)=>r===room&&p===(user===14?18:14)&&!blocked;
  const exchange=binding.createChatBindingExchange({owner:{user,account:record.account},current:()=>active,now:()=>now,
   random:async()=>crypto.randomBytes(32).toString('hex'),authorized,
   pin:async(p,a,current)=>{if(!current()||(pins.has(p)&&pins.get(p)!==a))return false;pins.set(p,a);return true;}});
  const transport=createChatBindingTransport({owner:user,current:()=>active,now:()=>now,authorized,exchange,
   sign:c=>{signs++;return binding.signChatBinding(record,key,user,c,now);},send:f=>{frames.push(f);return true;}});
  return {user,record,pins,frames,transport,block:()=>blocked=true,logout:()=>active=false,signs:()=>signs};
 });
 const inbound=(sender,frame)=>({...frame,event:'chat_identity_binding',from_user_id:sender.user});
 return {nodes,inbound};
}
test('authenticated challenge/proof round trip binds only the proven contact, never the requester claim',async()=>{
 const {nodes:[a,b],inbound}=fixture();assert.equal(await a.transport.request(room,b.user),true);
 assert.equal(await b.transport.receive(inbound(a,a.frames[0])),true);assert.equal(b.pins.size,0);
 assert.equal(await a.transport.receive(inbound(b,b.frames[0])),true);assert.equal(a.pins.get(b.user),b.record.account);
 assert.equal(await a.transport.receive(inbound(b,b.frames[0])),false,'proof replay');
});
test('tampered authenticated sender, room, oversized frames and unsolicited proofs fail closed',async()=>{
 const {nodes:[a,b],inbound}=fixture();await a.transport.request(room,b.user);const frame=inbound(a,a.frames[0]);
 for(const f of [{...frame,from_user_id:99},{...frame,room_id:'other'},{...frame,event:'peer_introduction'},
  {...frame,padding:'🙂'.repeat(4000)},{...frame,payload:{...frame.payload,requester:99}}])assert.equal(await b.transport.receive(f),false);
 assert.equal(b.signs(),0);assert.equal(await b.transport.receive(frame),true);
 const unsolicited={...inbound(b,b.frames[0]),payload:{...b.frames[0].payload,challenge:{...frame.payload,nonce:'00'.repeat(32)}}};
 assert.equal(await a.transport.receive(unsolicited),false);assert.equal(a.pins.size,0);
});
test('repeated challenge does not repeatedly sign; blocked and logged-out sessions stop responding',async()=>{
 const {nodes:[a,b],inbound}=fixture();await a.transport.request(room,b.user);const frame=inbound(a,a.frames[0]);
 assert.equal(await b.transport.receive(frame),true);assert.equal(await b.transport.receive(frame),false);assert.equal(b.signs(),1);
 a.block();assert.equal(await a.transport.receive(inbound(b,b.frames[0])),false);
 b.logout();assert.equal(await b.transport.request(room,a.user),false);
});
test('stop during async challenge creation prevents transmission',async()=>{
 const {nodes:[a,b]}=fixture();const request=a.transport.request(room,b.user);a.transport.stop();
 assert.equal(await request,false);assert.equal(a.frames.length,0);
});
test('Axion handler registration is disabled by default and stale cleanup cannot remove a replacement',async()=>{
 const bridge=load('chatBindingBridge');assert.equal(await bridge.routeChatBindingFrame({}),false);
 const handler=async()=>true,old=bridge.registerChatBindingHandler(handler),next=bridge.registerChatBindingHandler(handler);
 old();assert.equal(await bridge.routeChatBindingFrame({}),true);next();assert.equal(await bridge.routeChatBindingFrame({}),false);
 const stop=bridge.registerChatBindingHandler(async()=>{throw Error('Unavailable');});assert.equal(await bridge.routeChatBindingFrame({}),false);stop();
});
