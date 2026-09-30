const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const cache=new Map();
function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync(`src/services/identity/${name}.ts`,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(p=>p.startsWith('./')?load(p.slice(2).replace(/\.ts$/,'')):require(p),out);cache.set(name,out);return out;}
const protocol=load('identityProtocol'),binding=load('chatIdentityBinding');
function fixture(){
 let now=1800000000000,active=true,authorized=true,writeHook=()=>{};
 const random=()=>new Uint8Array(crypto.randomBytes(32)),key=random(),device=protocol.publicDevice(key,random());
 const record=protocol.issueRecord(random(),[device],now),pins=new Map();
 const owner={user:14,account:'axonic:1:'+'a1'.repeat(32)},room='22222222-2222-4222-8222-222222222222';
 const exchange=binding.createChatBindingExchange({owner,current:()=>active,now:()=>now,random:async()=>crypto.randomBytes(32).toString('hex'),
  authorized:(r,p)=>authorized&&r===room&&p===18,pin:async(peer,account,current)=>{writeHook();if(!current()||(pins.has(peer)&&pins.get(peer)!==account))return false;pins.set(peer,account);return true;}});
 return {exchange,pins,record,key,room,now:()=>now,proof:c=>binding.signChatBinding(record,key,18,c,now),
  expire:()=>now+=60001,block:()=>authorized=false,logout:()=>active=false,beforeWrite:fn=>writeHook=fn};
}
test('a fresh proof on the authenticated sender channel pins once and concurrent replay is rejected',async()=>{
 const f=fixture(),c=await f.exchange.challenge(f.room,18),p=f.proof(c);
 assert.deepEqual(await Promise.all([f.exchange.accept(18,p),f.exchange.accept(18,p)]),[true,false]);
 assert.equal(f.pins.get(18),f.record.account);
});
test('a signature alone cannot substitute for authenticated numeric identity, room or fresh challenge',async()=>{
 const f=fixture(),c=await f.exchange.challenge(f.room,18),p=f.proof(c);
 assert.equal(await f.exchange.accept(99,p),false);
 for(const change of [{roomId:'33333333-3333-4333-8333-333333333333'},{requester:99},{requesterAccount:'axonic:1:'+'b2'.repeat(32)},{nonce:'00'.repeat(32)},{expiresAt:c.expiresAt-1}]){
  assert.equal(await f.exchange.accept(18,{...p,challenge:{...c,...change}}),false);
 }
 assert.equal(await f.exchange.accept(18,{...p,signature:'00'.repeat(64)}),false);
 assert.equal(f.pins.size,0);assert.equal(await f.exchange.accept(18,p),true);
});
test('expired and unsolicited proofs cannot create contact bindings',async()=>{
 const f=fixture(),c=await f.exchange.challenge(f.room,18),p=f.proof(c);f.expire();
 assert.equal(await f.exchange.accept(18,p),false);assert.equal(await fixture().exchange.accept(18,p),false);
});
test('an authenticated replacement identity cannot silently overwrite a saved contact pin',async()=>{
 const f=fixture();let c=await f.exchange.challenge(f.room,18);assert.equal(await f.exchange.accept(18,f.proof(c)),true);
 c=await f.exchange.challenge(f.room,18);const different=fixture();
 const p=binding.signChatBinding(different.record,different.key,18,c,f.now());
 assert.equal(await f.exchange.accept(18,p),false);assert.equal(f.pins.get(18),f.record.account);
});
for(const change of ['block','logout','expire'])test(`${change} during pin storage invalidates the write`,async()=>{
 const f=fixture(),c=await f.exchange.challenge(f.room,18),p=f.proof(c);f.beforeWrite(f[change]);
 assert.equal(await f.exchange.accept(18,p),false);assert.equal(f.pins.size,0);
});
test('request state is bounded and stop removes pending permission',async()=>{
 const f=fixture();let c;for(let i=0;i<32;i++)assert(c=await f.exchange.challenge(f.room,18));
 assert.equal(await f.exchange.challenge(f.room,18),null);const p=f.proof(c);f.exchange.stop();
 assert.equal(await f.exchange.accept(18,p),false);assert.equal(await f.exchange.challenge(f.room,18),null);
});
