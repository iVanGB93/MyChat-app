const test = require('node:test'), assert = require('node:assert/strict');
const c = require('node:crypto');
const { createNeuronSignalRelay, createNeuronSignaling, signalBody, signalRequestBody, signalResponseBody } = require('../src/services/transports/neuronSignaling.ts');
function fixture() {
  let now = Date.now(); const node = c.randomUUID(), room = c.randomUUID();
  const keys = new Map([1,2,3,90].map(u => [u,c.generateKeyPairSync('ec',{namedCurve:'prime256v1'})]));
  const pub = u => keys.get(u)?.publicKey.export({type:'spki',format:'der'}).toString('base64') ?? null;
  const digest = async v => c.createHash('sha256').update(v).digest('hex');
  const sign = async (u,v) => c.sign('sha256',Buffer.from(v),keys.get(u).privateKey).toString('base64');
  const verify = async (k,v,s) => c.verify('sha256',Buffer.from(v),c.createPublicKey({key:Buffer.from(k,'base64'),type:'spki',format:'der'}),Buffer.from(s,'base64'));
  const relay = createNeuronSignalRelay({node,now:()=>now,key:pub,digest,sign:v=>sign(90,v),verify});
  const frame = to => ({type:'p2p_text_signal',protocol:1,room_id:room,session_id:c.randomUUID(),target_user_id:to,target_endpoint_id:null,signal_type:'offer',data:{sdp:'v=0\r\na=x-axonic-mailbox:1\r\n'}});
  const packet = async (from=1,to=2) => {const p={version:1,node,id:c.randomUUID(),from,to,time:now,endpoint:c.randomUUID(),frame:frame(to),signature:''};p.signature=await sign(from,await digest(signalBody(p)));return p;};
  const req = async (user,signal=null,ack=[]) => {const p={version:1,node,user,time:now,nonce:c.randomUUID(),signal,ack,signature:''};p.signature=await sign(user,await digest(signalRequestBody(p)));return p;};
  function client(user, options={}) {
    const received=[];let active=true,allow=true;
    const result=createNeuronSignaling({owner:user,endpoint:{url:'https://neuron.example',node,user:90,signing:pub(90)},endpointId:c.randomUUID(),uuid:c.randomUUID,now:()=>now,current:()=>active,key:pub,authorize:async()=>allow,digest,sign:v=>sign(user,v),verify,
      receive:async f=>received.push(f),fetch:async(_,o)=>{const p=await relay.exchange(JSON.parse(o.body));if(options.mutate)await options.mutate(p);return new Response(JSON.stringify(p),{status:p?200:403});}});
    return {...result,received,block:()=>allow=false,disable:()=>active=false};
  }
  return {node,room,pub,digest,sign,relay,frame,packet,req,client,advance:n=>now+=n};
}
test('signed relay routes only to the recipient, retries until ack, and rejects replay',async()=>{
 const f=fixture(),p=await f.packet(),req=await f.req(1,p);
 assert.equal((await f.relay.exchange(req)).accepted,true);assert.equal(await f.relay.exchange(req),null);
 assert.equal((await f.relay.exchange(await f.req(3))).signals.length,0);
 assert.equal((await f.relay.exchange(await f.req(2))).signals[0].id,p.id);
 await f.relay.exchange(await f.req(3,null,[p.id]));
 assert.equal((await f.relay.exchange(await f.req(2))).signals.length,1);
 assert.equal((await f.relay.exchange(await f.req(2,null,[p.id]))).signals.length,0);
});
test('relay rejects forged sender proof, expired data, unknown recipients and bounds its queue',async()=>{
 const f=fixture(),p=await f.packet();p.signature='forged';
 assert.equal((await f.relay.exchange(await f.req(1,p))).accepted,false);
 for(let i=0;i<32;i++)assert.equal((await f.relay.exchange(await f.req(1,await f.packet()))).accepted,true);
 assert.equal((await f.relay.exchange(await f.req(1,await f.packet()))).accepted,false);
 const expired=await f.packet();f.advance(21000);
 assert.equal(await f.relay.exchange(await f.req(1,expired)),null);
 assert.equal((await f.relay.exchange(await f.req(2))).signals.length,0);
 const unknown=await f.packet();unknown.to=999;unknown.frame.target_user_id=999;
 assert.equal(await f.relay.exchange(await f.req(1,unknown)),null);
});
test('clients authenticate and exchange offers without Axion, then suppress duplicate delivery',async()=>{
 const f=fixture(),a=f.client(1),b=f.client(2);assert.equal(a.send(f.frame(2)),true);
 assert.equal(await a.poll(),true);assert.equal(await b.poll(),true);
 assert.equal(b.received.length,1);assert.equal(b.received[0].from_user_id,1);
 assert.equal(a.status().sent,1);assert.equal(b.ready(),true);
 f.advance(1100);await b.poll();assert.equal(b.received.length,1);
 b.reset();assert.equal(b.ready(),false);b.stop();assert.equal(await b.poll(),false);
});
test('client rejects modified relay replies and independently verifies device signatures',async()=>{
 for(const mode of ['outer','inner']){
  const f=fixture();await f.relay.exchange(await f.req(1,await f.packet()));
  const b=f.client(2,{mutate:async r=>{r.signals[0].frame.data.sdp+='tampered';if(mode==='inner')r.signature=await f.sign(90,await f.digest(signalResponseBody(r)));}});
  await b.poll();assert.equal(b.received.length,0);
 }
});
test('blocked contacts and account teardown prevent receipt and outgoing signaling',async()=>{
 const f=fixture(),a=f.client(1),b=f.client(2);a.send(f.frame(2));await a.poll();b.block();await b.poll();assert.equal(b.received.length,0);
 a.disable();assert.equal(a.send(f.frame(2)),false);assert.equal(await a.poll(),false);
});
