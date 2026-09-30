const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const cache=new Map();
function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync(`src/services/identity/${name}.ts`,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(p=>p.startsWith('./')?load(p.slice(2).replace(/\.ts$/,'')):require(p),out);cache.set(name,out);return out;}
const protocol=load('normalChatProtocol'),{createNormalChatBoundary}=load('normalChatBoundary');
const a={user:14,account:'axonic:1:'+'a1'.repeat(32)},b={user:18,account:'axonic:1:'+'b2'.repeat(32)};
const message={id:'11111111-1111-4111-8111-111111111111',roomId:'22222222-2222-4222-8222-222222222222',content:'A normal conversation',createdAt:'2026-09-29T12:00:00.000Z'};
const now=Date.parse(message.createdAt);
function fixture(t){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE inbox(id TEXT PRIMARY KEY, body TEXT NOT NULL)');t.after(()=>db.close());
 let active=true,blocked=false,binding=b,local={...message},writes=0,receipts=0,beforePersist=()=>{};
 const common={current:()=>active,now:()=>now,authorized:()=>!blocked,
  readOutgoing:async()=>local,persist:async(m,current)=>{beforePersist();if(!current())return false;const raw=JSON.stringify(m),old=db.prepare('SELECT body FROM inbox WHERE id=?').get(m.id);if(old)return old.body===raw;db.prepare('INSERT INTO inbox VALUES(?,?)').run(m.id,raw);writes++;return true;},
  delivered:async(m,p,current)=>{if(!current())return false;assert.equal(m.id,message.id);assert.equal(p,b.user);receipts++;return true;}};
 const sender=()=>createNormalChatBoundary({...common,owner:a,peer:async room=>room===message.roomId?binding:null});
 const receiver=()=>createNormalChatBoundary({...common,owner:b,peer:async room=>room===message.roomId?a:null});
 return {sender,receiver,db,counts:()=>({writes,receipts}),block:()=>blocked=true,logout:()=>active=false,
  replace:()=>binding={...b,account:'axonic:1:'+'c3'.repeat(32)},edit:()=>local={...local,content:'edited'},beforePersist:f=>beforePersist=f};
}
test('normal UUID, room and content survive direct/custody retries; durable duplicate receives once',async t=>{
 const f=fixture(t),s=f.sender(),r=f.receiver(),packet=await s.prepare(message);
 assert.deepEqual(await f.sender().prepare(message),packet,'recreation cannot allocate another transport ID');
 assert.equal(protocol.decodeNormalChat(packet.text,now).id,message.id);
 for(let i=0;i<3;i++)assert.equal(await r.receive({from:a.account,...packet}),true);
 assert.equal(f.counts().writes,1);assert.equal(f.counts().receipts,0,'storage acceptance is not sender delivery');
 assert.equal(await s.confirm(message,b.account,packet.id),true);assert.equal(f.counts().receipts,1);
});
test('wire budget includes multibyte content and metadata; unsupported features stay on existing path',async t=>{
 const f=fixture(t);
 for(const m of [{...message,content:'🙂'.repeat(512)},{...message,replyTo:{id:message.id}},{...message,durationMs:0},{...message,content:null}])assert.equal(protocol.encodeNormalChat(m,a.user,b.user),null);
 for(const options of [{hydration:true},{targetRecipientId:99},{expectedRecipientIds:[18,99]}])assert.equal(await f.sender().prepare(message,options),null);
 const raw=protocol.encodeNormalChat(message,14,18);
 for(const bad of [raw+' ',raw.replace('axonic-chat-text-v1','axonic-test-message-v2'),'null','{}',JSON.stringify([...JSON.parse(raw),'extra'])])assert.equal(protocol.decodeNormalChat(bad,now),null);
 assert.equal(protocol.decodeNormalChat(raw,now-30001),null);
});
test('numeric claims, wrong identity, room, transport ID and reversed recipient cannot enter the inbox',async t=>{
 const f=fixture(t),packet=await f.sender().prepare(message),r=f.receiver();
 for(const p of [{...packet,from:b.account},{...packet,from:a.account,id:'00'.repeat(32)},
  {...packet,from:a.account,text:protocol.encodeNormalChat(message,99,18)},
  {...packet,from:a.account,text:protocol.encodeNormalChat(message,14,99)},
  {...packet,from:a.account,text:protocol.encodeNormalChat({...message,roomId:'33333333-3333-4333-8333-333333333333'},14,18)}])assert.equal(await r.receive(p),false);
 assert.equal(f.counts().writes,0);
});
test('conflicting duplicate content cannot be acknowledged or replace the saved normal message',async t=>{
 const f=fixture(t),packet=await f.sender().prepare(message),r=f.receiver();
 assert.equal(await r.receive({...packet,from:a.account}),true);
 assert.equal(await r.receive({...packet,from:a.account,text:protocol.encodeNormalChat({...message,content:'conflicting content'},14,18)}),false);
 assert.equal(f.counts().writes,1);
});
test('edited outbox rows, changed pins and unrelated receipts never mark delivery',async t=>{
 const f=fixture(t),s=f.sender(),p=await s.prepare(message);
 assert.equal(await s.confirm(message,b.account,'00'.repeat(32)),false);
 f.replace();assert.equal(await s.confirm(message,b.account,p.id),false);
 f.edit();assert.equal(await s.prepare(message),null);assert.equal(f.counts().receipts,0);
});
for(const change of ['block','logout'])test(`${change} before persistence prevents writes and receipts`,async t=>{
 const f=fixture(t),p=await f.sender().prepare(message);f.beforePersist(f[change]);
 assert.equal(await f.receiver().receive({...p,from:a.account}),false);assert.equal(f.counts().writes,0);
 assert.equal(await f.sender().confirm(message,b.account,p.id),false);
});
test('stopping a session invalidates in-flight peer lookup before any handoff',async t=>{
 const f=fixture(t),s=f.sender(),pending=s.prepare(message);s.stop();assert.equal(await pending,null);
});
test('caller mutation during lookup cannot change the message being authorized',async t=>{
 const f=fixture(t),mutable={...message},pending=f.sender().prepare(mutable);mutable.content='changed after invocation';
 const packet=await pending;assert.equal(protocol.decodeNormalChat(packet.text,now).content,message.content);
});
test('persistence failure never produces a successful receipt boundary result',async()=>{
 const raw=protocol.encodeNormalChat(message,14,18),m=protocol.decodeNormalChat(raw,now);
 const r=createNormalChatBoundary({owner:b,current:()=>true,now:()=>now,peer:async()=>a,authorized:()=>true,
  readOutgoing:async()=>null,persist:async()=>false,delivered:async()=>{throw Error('Unexpected delivery');}});
 assert.equal(await r.receive({from:a.account,id:protocol.normalChatTransportId(m,a.account,b.account),text:raw}),false);
});
