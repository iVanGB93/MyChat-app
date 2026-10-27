// Isolated native-WebSocket framing probe. No real identities, chat/store writes,
// or AoN connections. This is not a live custody/delivery benchmark.
const {Server:WebSocketServer}=require('ws');
const {execFileSync}=require('node:child_process');
const {run,evaluate}=require('./test-two-phone-dev.cjs');
const {load,fixture}=require('../tests/helpers/attachment.cjs');
const {createRelayBlockStream}=load('relayBlockStream'),batch=load('attachmentBatch'),protocol=load('attachmentProtocol');
const adb='C:/Users/iVan/AppData/Local/Android/Sdk/platform-tools/adb.exe';
async function main(){
 const targets=await(await fetch('http://127.0.0.1:8081/json/list')).json();
 const phone=targets.find(t=>t.appId==='com.axonic.dev'&&t.deviceName.startsWith('SM-S948U1'));
 if(!phone)throw Error('Phone Dev debugger unavailable');
 const devices=execFileSync(adb,['devices'],{encoding:'utf8'});
 if(!/^R3GYC0H7PMY\s+device$/m.test(devices))throw Error('Test phone unavailable');
 const server=new WebSocketServer({host:'127.0.0.1',port:19091,maxPayload:12000});
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 execFileSync(adb,['-s','R3GYC0H7PMY','reverse','tcp:19091','tcp:19091']);
 let ws,stream,reply;const results=[];let failure=null,maxFrame=0,frames=0;
 const connected=new Promise(resolve=>server.once('connection',socket=>{
  ws=socket;stream=createRelayBlockStream({current:()=>ws.readyState===1,send:f=>ws.send(JSON.stringify(f)),deliver:async f=>{reply?.(JSON.parse(f.body));}});
  ws.on('message',raw=>{frames++;maxFrame=Math.max(maxFrame,raw.length);stream.receive(JSON.parse(raw)).then(ok=>{if(!ok)failure='Invalid native frame';},e=>failure=e.message);});resolve();
 }));
 try{
  await run(phone,`if(globalThis.__relayBlockProbe)throw Error('Probe already active');
   const make=get('src/services/identity/relayBlockStream.ts').createRelayBlockStream;
   const ws=new WebSocket('ws://127.0.0.1:19091');
   const stream=make({current:()=>ws.readyState===1,send:f=>ws.send(JSON.stringify(f)),deliver:async f=>{
    const b=JSON.parse(f.body);await stream.transmit({kind:'bulk-response',id:f.id,body:JSON.stringify({status:'ok',index:b.index,count:1,data:b.data})});
   }});
   globalThis.__relayBlockProbe={ws,stream,error:null};
   ws.onmessage=e=>stream.receive(JSON.parse(e.data)).then(ok=>{if(!ok)globalThis.__relayBlockProbe.error='invalid';},()=>globalThis.__relayBlockProbe.error='receive failed');
   return true;`);
  await Promise.race([connected,new Promise((_,reject)=>setTimeout(()=>reject(Error('Native socket timeout')),10000))]);
  let id=0;
  for(const mib of [1,5,10]){
   const f=fixture(mib*1024*1024),began=performance.now();
   for(const chunk of f.chunks){
    const data=batch.packAttachmentBatch(f.manifest,chunk.index,[chunk]);
    let result;const arrived=new Promise(resolve=>reply=v=>{result=v;resolve();});
    await stream.transmit({kind:'bulk-request',id:++id,body:JSON.stringify({version:1,operation:'put-batch',digest:protocol.attachmentDigest(f.manifest),index:chunk.index,count:1,data})});
    await arrived;
    if(failure||result.data!==data||!protocol.verifyAttachmentChunk(f.manifest,batch.unpackAttachmentBatch(f.manifest,chunk.index,1,result.data)[0]))throw Error(failure||'Ciphertext integrity failure');
   }
   results.push({mib,blocks:f.chunks.length,roundTripMs:Math.round(performance.now()-began),ciphertextIdentical:true});
  }
  const error=await evaluate(phone,'globalThis.__relayBlockProbe.error');if(error)throw Error(error);
  console.log(JSON.stringify({passed:true,scope:'Isolated USB-forwarded native WebSocket; not live custody or internet throughput',maxFrame,frames,results}));
 }finally{
  await evaluate(phone,'if(globalThis.__relayBlockProbe){globalThis.__relayBlockProbe.stream.stop();globalThis.__relayBlockProbe.ws.close();delete globalThis.__relayBlockProbe;}true').catch(()=>{});
  stream?.stop();ws?.terminate();await new Promise(resolve=>server.close(resolve));
  execFileSync(adb,['-s','R3GYC0H7PMY','reverse','--remove','tcp:19091']);
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
