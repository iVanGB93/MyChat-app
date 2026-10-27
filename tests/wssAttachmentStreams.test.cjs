const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {load}=require('./helpers/attachment.cjs');
const {createWssStreamCipher:cipher}=load('wssStreamCipher');
const {createWssAttachmentStreams:create}=load('wssAttachmentStreams');
const random=n=>new Uint8Array(crypto.randomBytes(n)),hex=()=>crypto.randomBytes(32).toString('hex');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');

test('a late successful lease check cannot restore a stream after concurrent revocation',async()=>{
 const fs=require('node:fs'),ts=require('typescript'),out={};let adapter,rejectStart;
 new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/wssAttachmentStreams.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>{
  if(name==='./directAttachmentStream.ts')return {createDirectAttachmentStream:d=>{adapter=d;return {start:()=>new Promise((_,reject)=>rejectStart=reject),abort:()=>rejectStart(Error('revoked'))};}};
  return name.startsWith('./')?load(name.slice(2).replace(/\.ts$/,'')):require(name);
 },out);
 const outcomes=[],resolvers=[];let concurrent=false;
 const peer={account:'b',device:'db',instance:'one'},job={owner:'a',digest:hex(),descriptor:{key:hex(),checksum:hex(),manifest:{sender:'a',recipient:'b',recipientDevice:'db',expires:Date.now()+60000,bytes:1}}};
 const manager=out.createWssAttachmentStreams({current:()=>true,peer:()=>peer,random:async n=>random(n),send:()=>true,request:async()=>null,files:()=>({discard(){},hash:async()=>'',commit:async()=>{throw Error('must not commit');}}),outcome:v=>outcomes.push(v)});
 assert.equal(await manager.serve(job,()=>concurrent?new Promise(resolve=>resolvers.push(resolve)):Promise.resolve(true),hex()),true);
 concurrent=true;
 const older=adapter.authorize(),newer=adapter.authorize();
 const olderRejected=assert.rejects(older,/revoked/),newerRejected=assert.rejects(newer,/revoked/);
 resolvers[1](false);await newerRejected;resolvers[0](true);await olderRejected;
 assert.equal(adapter.live(),false);manager.stop();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(outcomes.length,1);assert.equal(outcomes[0].guard,'durable-lease');assert.equal(outcomes[0].result,'failed');
});
test('optimized serialization matches independent original v1 encoding across scratch reuse',()=>{
 const {hkdf}=require('@noble/hashes/hkdf.js'),{sha256}=require('@noble/hashes/sha2.js'),{xchacha20poly1305}=require('@noble/ciphers/chacha.js');
 const input={key:hex(),digest:hex(),id:hex(),salt:random(16),role:'send'},a=cipher(input);
 const key=hkdf(sha256,Buffer.from(input.key,'hex'),Buffer.from(input.id,'hex'),Buffer.from('axonic-wss-stream-v1:'+input.digest+':0'),32);
 const salt=Buffer.from(input.salt).toString('hex');let seq=0;
 for(const value of [random(8192),'ack',random(1),random(8192),'x'.repeat(1024)]){
  const bytes=typeof value==='string'?Buffer.from(value):value,plain=Buffer.concat([Buffer.from([typeof value==='string'?0:1]),bytes]),nonce=Buffer.alloc(24);nonce.set(input.salt);nonce.writeUInt32BE(seq,20);
  const aad=Buffer.from(JSON.stringify(['axonic-wss-stream-v1',input.digest,input.id,0,salt,seq]));
  const expected=JSON.stringify({salt,seq,data:Buffer.from(xchacha20poly1305(key,nonce,aad).encrypt(plain)).toString('base64')});assert.equal(a.seal(value),expected);seq++;
 }a.close();
});
function codecs(overrides={}){const input={key:hex(),digest:hex(),id:hex()};return [cipher({...input,salt:random(16),role:'send'}),cipher({...input,...overrides,salt:random(16),role:'receive'})];}
test('WSS encryption authenticates controls and binary records in both directions',()=>{
 const [a,b]=codecs();assert.equal(b.open(a.seal('ready')),'ready');const bytes=random(8192);assert.deepEqual(new Uint8Array(b.open(a.seal(bytes))),bytes);assert.equal(a.open(b.seal('ack')),'ack');a.close();b.close();assert.throws(()=>a.seal('x'));assert.throws(()=>b.open('{}'));
});
for(const field of ['key','digest','id'])test(`WSS rejects different ${field}`,()=>{const [a,b]=codecs({[field]:hex()});assert.throws(()=>b.open(a.seal('ready')));});
test('WSS rejects reflection, tampering, replay and out of order without advancing on failure',()=>{
 const [a,b]=codecs(),first=a.seal('one'),second=a.seal('two');assert.throws(()=>a.open(first));assert.throws(()=>b.open(second));const bad=JSON.parse(first);bad.data=(bad.data[0]==='A'?'B':'A')+bad.data.slice(1);assert.throws(()=>b.open(JSON.stringify(bad)));assert.equal(b.open(first),'one');assert.throws(()=>b.open(first));assert.equal(b.open(second),'two');assert.throws(()=>a.seal(random(8193)));assert.throws(()=>a.seal('a'.repeat(1025)));
});
function fixture(t,size,mode){
 const source=crypto.randomBytes(size),digest=hex(),descriptor={key:hex(),checksum:hash(source),manifest:{sender:'a',recipient:'b',senderDevice:'da',recipientDevice:'db',expires:Date.now()+60000,bytes:size}};
 const peers=[{account:'a',device:'da',instance:'ia'},{account:'b',device:'db',instance:'ib'}];let managers=[],committed=null,commits=0,active=true,frames=0;const outcomes=[[],[]],checks=[0,0],timings=[load('attachmentTiming').createAttachmentTiming(true),load('attachmentTiming').createAttachmentTiming(true)];
 const lease=async side=>{checks[side]++;if(mode==='revoke'&&side===1&&checks[side]>=5)active=false;return active;};
 const jobs=[{owner:'a',digest,descriptor},{owner:'b',digest,descriptor}];
 for(let side=0;side<2;side++)managers[side]=create({
  outcome:v=>outcomes[side].push(v),timing:timings[side],random:async n=>random(n),current:()=>active,peer:account=>peers.find(p=>p.account===account),
  send(account,instance,raw){assert.equal(instance,peers[1-side].instance);frames++;if(mode==='disconnect'&&frames===4){active=false;return false;}if(mode==='tamper'&&side===0&&frames===4){const outer=JSON.parse(raw),record=JSON.parse(outer.data);record.data=(record.data[0]==='A'?'B':'A')+record.data.slice(1);outer.data=JSON.stringify(record);raw=JSON.stringify(outer);}
   queueMicrotask(()=>{const accepted=managers[1-side].receive(raw,peers[side]);if(!mode&&active)assert.equal(accepted,true);if(mode==='tamper'&&frames>=4){active=false;}});return true;},
  request:async(account,raw)=>{const r=JSON.parse(raw);assert.equal(r.transport,'wss-v1');return JSON.stringify({status:await managers[0].serve(jobs[0],()=>lease(0),r.id)?'streaming':'unavailable'});},
  files(job,id,role){let pos=0,parts=[];return {reader:()=>({read:n=>{const v=new Uint8Array(source.subarray(pos,pos+n));pos+=v.length;return v;},close(){}}),writer:()=>({write:v=>parts.push(Buffer.from(v)),close(){}}),hash:async()=>hash(Buffer.concat(parts)),commit:async()=>{committed=Buffer.concat(parts);commits++;},discard(){parts=[];}};}
 });
 t.after(()=>managers.forEach(m=>m.stop()));return {outcomes,checks,timings,run:()=>managers[1].pull(jobs[1],()=>lease(1)),verify(){assert.equal(commits,1);assert.deepEqual(committed,source);},empty(){assert.equal(commits,0);assert.equal(committed,null);}};
}
for(const size of [1_000_000,5_000_000,10_000_000])test(`existing WSS encrypted stream verifies ${size} bytes`,async t=>{const f=fixture(t,size);assert.equal(await f.run(),true);f.verify();});
for(const mode of ['disconnect','tamper','revoke'])test(`WSS ${mode} never publishes partial file`,async t=>{const f=fixture(t,1_000_000,mode);assert.equal(await f.run(),false);f.empty();});
test('receiver durable checks follow credit grants, not every binary frame wake',async t=>{const f=fixture(t,1_000_000);assert.equal(await f.run(),true);f.verify();assert(f.checks[1]>=30);assert(f.checks[1]<70,JSON.stringify(f.checks));});

test('stream phase diagnostics record bounded aggregates without changing verified delivery',async t=>{
 const f=fixture(t,131072);assert.equal(await f.run(),true);f.verify();
 const sender=f.timings[0].snapshot(),receiver=f.timings[1].snapshot();
 assert.equal(receiver.streamSetup.calls,1);
 const outcome=f.outcomes[1][0];assert(outcome.firstRecordMs>=0);assert(outcome.firstDataMs>=outcome.firstRecordMs);assert(outcome.milliseconds>=outcome.firstDataMs);
 assert(sender.streamSeal.calls>1);assert(receiver.streamOpen.calls>1);
 assert(sender.streamBurstYield.calls>0);
 for(const rows of [sender,receiver])for(const value of Object.values(rows)){
  assert.deepEqual(Object.keys(value).sort(),['calls','errors','maximum','milliseconds']);
  assert.equal(value.errors,0);assert(value.milliseconds>=0);
 }
});
