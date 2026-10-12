// Explicitly invoked Dev-only lab. Uses signed SDP via the desktop, not the
// production discovery path. Native pre-bridge binary admission is NOT tested.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ts=require('typescript');
const {run}=require('../../builds/mailbox-device-background.cjs');
const {createDirectStreamSession}=require('./direct-stream-session.cjs');
const statePath=path.resolve('builds/direct-stream-current.json');
async function main(){
 const list=await(await fetch('http://127.0.0.1:8081/json/list')).json();
 const targets=['bfa3a971','737378d0'].map(p=>list.find(t=>t.id.startsWith(p)));
 if(targets.some(t=>!t)||targets[1].appId!=='com.axonic.dev')throw Error('Test emulator and phone Dev required');
 const call=(i,body)=>run(targets[i],ts.transpileModule(`return (async()=>{${body}})()`,{compilerOptions:{target:1,module:0,downlevelIteration:true}}).outputText);
 const mode=process.argv[2];
 if(mode==='setup'){
  const accounts=[];for(let i=0;i<2;i++)accounts.push(await call(i,`const a=get('src/services/identity/localAccount.ts').localAccount;if(a.status().state!=='unlocked')throw Error('Unlock Dev');return a.status().account;`));
  for(let i=0;i<2;i++)console.log(await call(i,`
   if(globalThis.__directLab)throw Error('Lab already active');
   const account=get('src/services/identity/localAccount.ts').localAccount,owner=${JSON.stringify(accounts[i])},other=${JSON.stringify(accounts[1-i])};
   const rtcName=[...__r.getModules()].map(([id,m])=>m.verboseName).find(n=>/react-native-webrtc.*[\\/]index\\.(ts|js)$/.test(n));if(!rtcName)throw Error('RTC module missing');
   const {RTCPeerConnection}=get(rtcName),files=get('src/services/identity/rootAttachmentFiles.ts'),native=get('modules/axonic-nearby/index.ts').default;
   const pc=new RTCPeerConnection({iceServers:[{urls:['stun:stun.l.google.com:19302']}]});
   const lab=globalThis.__directLab={pc,owner,other,account,files,native,owned:new Set(),verified:false,channel:null,session:null};
   lab.live=()=>lab.verified&&account.status().state==='unlocked'&&account.status().account===owner&&lab.channel?.readyState==='open';
   lab.attach=c=>{if(lab.channel||c.label!=='axonic-direct-lab-v1'){c.close();throw Error('Unexpected lab channel');}lab.channel=c;
    lab.stream=(${createDirectStreamSession.toString()})({live:lab.live,now:Date.now,wait:()=>new Promise(r=>setTimeout(r,1)),
     send:v=>c.send(v),close:()=>c.close(),
     remove:id=>{if(lab.owned.has(id)){const dir=files.rootAttachmentFile(owner,id).parentDirectory;if(dir.exists)dir.delete();lab.owned.delete(id);}},
     hash:(id,bytes)=>native.attachmentFileSha256(owner,id,true,bytes),
     reader:id=>{const h=files.rootAttachmentFile(owner,id).open();return {read:n=>h.readBytes(n),close:()=>h.close()};},
     writer:id=>{const f=files.rootAttachmentFile(owner,id);if(f.parentDirectory.exists)throw Error('Fixture already exists');f.parentDirectory.create({intermediates:true});lab.owned.add(id);f.create();const h=f.open();return {write:b=>h.writeBytes(b),close:()=>h.close()};}
    });c.addEventListener('message',e=>void lab.stream.receive(e.data).catch(e=>lab.error=String(e)));c.addEventListener('close',()=>lab.stream.abort('Channel closed'));
   };
   pc.addEventListener('datachannel',e=>lab.attach(e.channel));
   lab.gather=async()=>{const end=Date.now()+6000;while(pc.iceGatheringState!=='complete'&&Date.now()<end)await new Promise(r=>setTimeout(r,50));};
   lab.check=async(raw,kind)=>{const s=get('src/services/identity/axonSignaling.ts').verifyAxonSignal(raw,Date.now());
    if(!s||s.kind!==kind||s.record.account!==other||s.target!==owner||(lab.session&&s.session!==lab.session)||!get('src/services/identity/rtcAxonTransport.ts').validAxonSdp(s.sdp))throw Error('Invalid signed lab peer');
    const known=await get('src/services/identity/identityRecordStore.ts').createMobileIdentityRecordStore(Date.now).read(other);
    if(get('src/services/identity/identityProtocol.ts').compareRecord(s.record,known,Date.now(),s.history)!=='accept')throw Error('Stale peer identity');
    return s;};
   lab.timer=setInterval(()=>{if(account.status().state!=='unlocked'||account.status().account!==owner||['failed','closed'].includes(pc.connectionState)){lab.stream?.abort('Session invalidated');pc.close();}},250);
   return {ready:true};`));
  fs.writeFileSync(statePath,JSON.stringify({accounts}));
 }else if(mode==='connect'){
  const offer=await call(0,`const l=globalThis.__directLab;l.session=await l.native.identityRandomBytes(32);l.attach(l.pc.createDataChannel('axonic-direct-lab-v1',{ordered:true}));await l.pc.setLocalDescription(await l.pc.createOffer());await l.gather();return l.account.signSignal(l.other,l.session,'offer',l.pc.localDescription.sdp);`);
  const answer=await call(1,`const l=globalThis.__directLab,s=await l.check(${JSON.stringify(offer)},'offer');l.session=s.session;await l.pc.setRemoteDescription({type:'offer',sdp:s.sdp});l.verified=true;await l.pc.setLocalDescription(await l.pc.createAnswer());await l.gather();return l.account.signSignal(l.other,l.session,'answer',l.pc.localDescription.sdp);`);
  await call(0,`const l=globalThis.__directLab,s=await l.check(${JSON.stringify(answer)},'answer');await l.pc.setRemoteDescription({type:'answer',sdp:s.sdp});l.verified=true;return true;`);console.log({signedPeers:true});
 }else if(mode==='core-send'){
  // Exercise the typed candidate on real devices, still on the isolated lab lane.
  // This does not claim production native admission or chat integration is enabled.
  const bytes=Number(process.argv[3]||524287),id=crypto.randomBytes(32).toString('hex');
  if(!Number.isInteger(bytes)||bytes<1||bytes>8*1024*1024)throw Error('Invalid workload');
  const plain=Buffer.alloc(bytes);for(let n=0;n<bytes;n++)plain[n]=n%251;
  const state=JSON.parse(fs.readFileSync(statePath));Object.assign(state,{id,bytes,frameBytes:16384,hash:crypto.createHash('sha256').update(plain).digest('hex')});fs.writeFileSync(statePath,JSON.stringify(state));
  const source=ts.transpileModule(fs.readFileSync('src/services/identity/directAttachmentStream.ts','utf8'),{compilerOptions:{target:99,module:1}}).outputText;
  // Receiver is explicitly authorized for this exact synthetic file before send.
  for(const i of [1,0])console.log(await call(i,`
   const l=globalThis.__directLab;if(!l.live())throw Error('Lab not connected');
   const id='${id}',f=l.files.rootAttachmentFile(l.owner,id);
   if(f.parentDirectory.exists)throw Error('Fixture exists');
   f.parentDirectory.create({intermediates:true});l.owned.add(id);
   if(${i}===0){const b=new Uint8Array(${bytes});for(let n=0;n<b.length;n++)b[n]=n%251;f.write(b);}
   const exports={};${source}
   const results=[],started=Date.now();
   const session=exports.createDirectAttachmentStream({role:${JSON.stringify(i===0?'send':'receive')},
    expected:{digest:id,bytes:${bytes},checksum:'${state.hash}'},live:l.live,now:Date.now,wait:()=>new Promise(r=>setTimeout(r,1)),
    send:v=>l.channel.send(v),close:()=>l.channel.close(),
    hash:()=>l.native.attachmentFileSha256(l.owner,id,true,${bytes}),
    discard:()=>{if(l.owned.has(id)&&f.parentDirectory.exists)f.parentDirectory.delete();},
    reader:()=>{const h=f.open();return {read:n=>h.readBytes(n),close:()=>h.close()};},
    writer:()=>{f.create();const h=f.open();return {write:b=>h.writeBytes(b),close:()=>h.close()};}
   });
   l.stream={...session,results};l.last=null;
   if(${i===1&&process.argv[4]==='interrupt'})l.stream.receive=async data=>{await session.receive(data);if(data instanceof ArrayBuffer)l.channel.close();};
   session.start().then(()=>{const r={id,bytes:${bytes},elapsedMs:Date.now()-started,verified:true};results.push(r);l.last=r;},e=>{l.last={error:String(e)};});
   return {candidateStarted:true,role:${JSON.stringify(i===0?'send':'receive')},bytes:${bytes}};
  `));
 }else if(mode==='send'){
  const bytes=Number(process.argv[3]||524287),frameBytes=Number(process.argv[4]||65536),id=crypto.randomBytes(32).toString('hex');
  if(!Number.isInteger(bytes)||bytes<1||bytes>8*1024*1024||![16384,65536].includes(frameBytes))throw Error('Invalid workload');
  const plain=Buffer.alloc(bytes);for(let n=0;n<bytes;n++)plain[n]=n%251;
  const state=JSON.parse(fs.readFileSync(statePath));Object.assign(state,{id,bytes,frameBytes,hash:crypto.createHash('sha256').update(plain).digest('hex')});fs.writeFileSync(statePath,JSON.stringify(state));
  console.log(await call(0,`const l=globalThis.__directLab;if(!l.live())throw Error('Lab not connected');const id='${id}',f=l.files.rootAttachmentFile(l.owner,id);if(f.parentDirectory.exists)throw Error('Fixture exists');f.parentDirectory.create({intermediates:true});l.owned.add(id);const b=new Uint8Array(${bytes});for(let n=0;n<b.length;n++)b[n]=n%251;f.write(b);l.last=null;l.stream.send(id,${bytes},${frameBytes}).then(r=>l.last=r,e=>l.last={error:String(e)});return {started:true,bytes:${bytes},frameBytes:${frameBytes}};`));
 }else if(mode==='auth-check'){
  const signed=await call(0,`const l=globalThis.__directLab;return l.account.signSignal(l.other,l.session,'offer',l.pc.localDescription.sdp);`);
  console.log(await call(1,`const l=globalThis.__directLab,raw=${JSON.stringify(signed)};await l.check(raw,'offer');const original=JSON.parse(raw),cases=[{...original,target:l.other},{...original,session:'0'.repeat(64)},{...original,expiresAt:1},{...original,sdp:original.sdp+'a=x-tampered:1\\r\\n'}];let rejected=0;for(const s of cases){try{await l.check(JSON.stringify(s),'offer');}catch{rejected++;}}if(rejected!==cases.length)throw Error('Accepted altered signal');return {validAccepted:true,alteredSignalsRejected:rejected};`));
 }else if(mode==='inspect'){
  for(let i=0;i<2;i++)console.log(await call(i,`const l=globalThis.__directLab;return {connected:l.live(),path:get('src/services/identity/rtcAxonTransport.ts').rtcPathSummary(await l.pc.getStats())};`));
 }else if(mode==='interrupt-next'){
  console.log(await call(1,`const l=globalThis.__directLab,receive=l.stream.receive;l.stream.receive=async data=>{await receive(data);if(data instanceof ArrayBuffer)l.channel.close();};return {interruptAfterFirstFrame:true};`));
 }else if(mode==='status'){
  const state=JSON.parse(fs.readFileSync(statePath));for(let i=0;i<2;i++)console.log(JSON.stringify({device:i,result:await call(i,`const l=globalThis.__directLab;let independentlyVerified=null;const r=l.stream?.results.find(x=>x.id==='${state.id}'&&x.verified);if(${i}===1&&r)independentlyVerified=await l.native.attachmentFileSha256(l.owner,'${state.id}',true,${state.bytes})==='${state.hash}';return {connected:l.live(),state:l.pc.connectionState,result:${i}===0?l.last:r,independentlyVerified,fixtureExists:l.files.rootAttachmentFile(l.owner,'${state.id}').exists,error:l.error??null};`)}));
 }else if(mode==='cleanup'){
  for(let i=0;i<2;i++)console.log(await call(i,`const l=globalThis.__directLab;if(l){clearInterval(l.timer);l.stream?.abort('Lab finished');l.pc.close();for(const id of l.owned){const dir=l.files.rootAttachmentFile(l.owner,id).parentDirectory;if(dir.exists)dir.delete();}delete globalThis.__directLab;}return {cleaned:true};`));
 }else throw Error('Use setup/connect/send/status/interrupt-next/cleanup');
}
main().catch(e=>{console.error(String(e));process.exitCode=1;});
