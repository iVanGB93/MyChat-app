const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const cache=new Map();function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(p=>p.startsWith('./')?load(p.slice(2).replace(/\.ts$/,'')):require(p),out);cache.set(name,out);return out;}

const p=load('identityProtocol'),{createPersistentAxon}=load('persistentAxon'),{createRecoveryLookupSession}=load('recoveryLookupSession');
const {DIRECTORY_DOMAIN,DIRECTORY_LEASE}=load('identityDirectory');
const now=1800000000000,random=async n=>new Uint8Array(crypto.randomBytes(n));
function store(){const records=new Map();return{read:async id=>records.get(id)??null,compareAndSet:async(id,expected,next)=>{const old=records.get(id);if((old?p.recordDigest(old):null)!==expected)return false;records.set(id,next);return true;}};}
function wires(){let dead=false;const listeners=[],closed=[],queues=[[],[]];const frames=[];
 const wire=i=>({listen(fn,end){listeners[i]=fn;closed[i]=end;for(const raw of queues[i])queueMicrotask(()=>!dead&&fn(raw));queues[i]=[];return()=>{listeners[i]=null;closed[i]=null;};},
 send(raw){if(dead)throw Error('closed');frames.push(raw);queueMicrotask(()=>{if(!dead){if(listeners[1-i])listeners[1-i](raw);else queues[1-i].push(raw);}});},
 close(){if(dead)return;dead=true;for(const end of closed)end?.();}});
 return{wire,frames,closed:()=>dead};}
async function person(){const signingSeed=await random(32);return{signingSeed,record:p.issueRecord(await random(32),[p.publicDevice(signingSeed,await random(32))],now)};}
test('a temporary visitor reads a record without account recovery, reuses one connection, and closes',async t=>{
 const host=await person(),owner=await person(),transport=wires();let hostSession,dials=0,seen=[];
 const client=createRecoveryLookupSession({random,now:()=>now,peer:host.record.account,store:store(),connect:async(account)=>{
  dials++;assert.notEqual(account,owner.record.account);
  hostSession=createPersistentAxon({...host,instance:await random(32),store:store(),wire:transport.wire(1),now:()=>now,current:()=>true,random,onClosed(){},onDirectory:async raw=>{seen.push(JSON.parse(raw));return JSON.stringify({domain:DIRECTORY_DOMAIN,status:'found',packet:{record:owner.record,history:[]},until:now+DIRECTORY_LEASE});}});
  return transport.wire(0);
 }});t.after(()=>{client.stop();hostSession?.stop();});
 // Both peers authenticate asynchronously; a startup race may return unavailable and is retryable.
 let result;for(let i=0;i<3;i++){result=await client.lookup(owner.record);if(result.status==='found')break;await new Promise(r=>setTimeout(r,25));}
 assert.equal(result.status,'found');assert.equal((await client.lookup(owner.record)).status,'found');assert.equal(dials,1);
 assert(seen.every(v=>v.operation==='get'&&v.account===owner.record.account));
 assert(!transport.frames.some(v=>v.includes('recoveryPhrase')||v.includes('password')||v.includes('entropy')));
 client.stop();assert(transport.closed());assert.equal((await client.lookup(owner.record)).status,'cancelled');
});
test('cancel during native dial closes a late wire and concurrent lookup is bounded',async()=>{
 const owner=await person();let resolve,started=false,closed=false;
 const client=createRecoveryLookupSession({random,now:()=>now,peer:owner.record.account,store:store(),connect:async()=>{started=true;return new Promise(r=>resolve=r);}});
 const pending=client.lookup(owner.record);while(!started)await new Promise(r=>setImmediate(r));
 assert.equal((await client.lookup(owner.record)).status,'busy');client.stop();
 resolve({close(){closed=true;},send(){throw Error('must not send');},listen(){throw Error('must not listen');}});
 assert.equal((await pending).status,'unavailable');assert(closed);
});
test('cancel during random generation destroys generated secrets and never dials',async()=>{
 const owner=await person();let release,first=true,dials=0;const material=[];
 const client=createRecoveryLookupSession({random:async n=>{const v=await random(n);material.push(v);if(first){first=false;await new Promise(r=>release=r);}return v;},now:()=>now,peer:owner.record.account,store:store(),connect:async()=>{dials++;throw Error('unexpected');}});
 const pending=client.lookup(owner.record);while(!release)await new Promise(r=>setImmediate(r));client.stop();release();await pending;
 assert.equal(dials,0);assert(material.every(v=>v.every(x=>x===0)));
});
