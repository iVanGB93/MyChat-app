// Authorized phone Dev <-> emulator test. Never targets the normal phone app.
const {run,until}=require('./test-two-phone-dev.cjs');
const {execFileSync}=require('node:child_process');
const adb='C:/Users/iVan/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const quote=JSON.stringify;
const stamp=new Date().toISOString();
const targets=async()=> (await (await fetch('http://127.0.0.1:8081/json/list')).json());
async function main(){
 const all=await targets();
 let a=all.find(t=>t.appId==='com.axonic.dev'&&t.deviceName.startsWith('SM-S948U1'));
 let b=all.find(t=>t.appId==='com.axonic'&&t.deviceName.startsWith('sdk_gphone64_x86_64'));
 if(!a||!b)throw Error('Required phone Dev and Android emulator debugger targets missing');
 const serial='emulator-5554';
 const model=execFileSync(adb,['-s',serial,'shell','getprop','ro.product.model'],{encoding:'utf8'}).trim();
 if(model!=='sdk_gphone64_x86_64')throw Error('Emulator serial/model mismatch');
 const inspect=t=>run(t,`const s=account.status();if(s.state!=='unlocked'||s.busy)throw Error('Test account locked');if(typeof get('src/services/identity/sessionRouting.ts').createSessionRouting!=='function')throw Error('Shared routing module missing');const rows=(await ledger().snapshot()).messages;return {account:s.account,count:rows.length,keys:rows.map(m=>m.peer+':'+m.direction+':'+m.id)};`);
 const [aa,bb]=await Promise.all([inspect(a),inspect(b)]);
 if(aa.account===bb.account)throw Error('Test identities must differ');
 console.log(JSON.stringify({test:'Current shared routing loaded',phoneDev:true,emulator:true,baselineMessages:[aa.count,bb.count]}));
 if(process.argv.includes('--inspect-only'))return;
 for(const [t,peer] of [[a,bb.account],[b,aa.account]])await run(t,`const c=(await ledger().snapshot()).contacts.find(c=>c.account===${quote(peer)});if(c?.blocked)throw Error('Test peer blocked');if(!c?.accepted)await ledger().configure(${quote(peer)},{accepted:true});return true;`);
 const state=(t,peer,id,direction)=>run(t,`const view=get('src/services/identity/rootChatActions.ts').rootChatView(account.status().account,await ledger().snapshot());const rows=view.messages.filter(m=>m.peer===${quote(peer)}&&m.id===${quote(id)}&&m.direction===${quote(direction)});return rows.map(m=>({status:m.status,read:!!m.read}));`);
 const delivery=async(sender,receiver,from,to,id)=>until(async()=>{const [s,r]=await Promise.all([state(sender,to,id,'outgoing'),state(receiver,from,id,'incoming')]);if(s.length>1||r.length>1)throw Error('Duplicate test message');return s[0]?.status==='delivered'&&r[0]?.status==='delivered';},'Delivery',120000);
 const records=[];
 if(process.argv.includes('--phone-reconnect-only')){
  const phone='R3GYC0H7PMY';
  if(execFileSync(adb,['-s',phone,'shell','getprop','ro.product.model'],{encoding:'utf8'}).trim()!=='SM-S948U1')throw Error('Phone model mismatch');
  execFileSync(adb,['-s',phone,'shell','am','force-stop','com.axonic.dev']);
  const id=await run(b,`return messaging.sendText(${quote(aa.account)},${quote('[DEV TEST] Queued while phone Dev stopped '+stamp)});`);
  console.log(JSON.stringify({test:'Phone Dev offline enqueue',state:await state(b,aa.account,id,'outgoing')}));
  execFileSync(adb,['-s',phone,'shell','am','start','-a','android.intent.action.VIEW','-d','exp+axonic-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081','-p','com.axonic.dev']);
  a=(await until(async()=>(await targets()).find(t=>t.appId==='com.axonic.dev'&&t.deviceName.startsWith('SM-S948U1')),'Phone Dev debugger reconnect')).value;
  await until(async()=>{try{return (await inspect(a)).account===aa.account;}catch{return false;}},'Same phone Dev identity restored');
  const d=await delivery(b,a,bb.account,aa.account,id);
  const after=await inspect(a);if(!aa.keys.every(k=>after.keys.includes(k)))throw Error('Existing phone Dev message missing');
  console.log(JSON.stringify({test:'Phone Dev restart',passed:true,queuedMessageDeliveredExactlyOnce:true,deliveryObservedMs:d.elapsedMs,sameIdentity:true,existingMessageRecordsPreserved:aa.count,normalPhoneAppUntouched:true}));return;
 }
 for(const [sender,receiver,from,to,label] of [[a,b,aa.account,bb.account,'Phone to emulator'],[b,a,bb.account,aa.account,'Emulator to phone']]){
  const id=await run(sender,`return messaging.sendText(${quote(to)},${quote('[DEV TEST] Shared routing '+label+' '+stamp)});`);
  const d=await delivery(sender,receiver,from,to,id);
  await run(receiver,`await messaging.readMessages(${quote(from)},[${quote(id)}]);return true;`);
  await until(async()=>(await state(sender,to,id,'outgoing'))[0]?.read,'Read receipt');
  records.push({from,to,id});console.log(JSON.stringify({test:label,delivered:true,read:true,deliveryObservedMs:d.elapsedMs}));
 }
 for(const [sender,receiver,from,to,label] of [[a,b,aa.account,bb.account,'Phone file to emulator'],[b,a,bb.account,aa.account,'Emulator file to phone']]){
  const media=await run(sender,`const fs=find(/expo-file-system.*index\\.(ts|js)$/);const name='dev-routing-'+Date.now()+'.txt';const f=new fs.File(fs.Paths.cache,name);f.create();const text='[DEV TEST] Shared connection synthetic attachment.\\n'.repeat(4096);f.write(text);const id=await get('src/services/identity/rootAttachmentRuntime.ts').queueRootAttachmentSource(${quote(to)},f.uri,name,'text/plain');return {id,bytes:new TextEncoder().encode(text).length};`);
  const d=await delivery(sender,receiver,from,to,media.id);
  const content=await run(receiver,`const m=(await ledger().snapshot()).messages.find(m=>m.id===${quote(media.id)}&&m.peer===${quote(from)}&&m.direction==='incoming');if(!m?.attachment)throw Error('Attachment missing');const file=get('src/services/identity/rootAttachmentFiles.ts').rootAttachmentFile(account.status().account,get('src/services/identity/attachmentProtocol.ts').attachmentDigest(m.attachment.manifest));const bytes=file.bytesSync();const hash=get('node_modules/@noble/hashes/utils.js').bytesToHex(get('node_modules/@noble/hashes/sha2.js').sha256(bytes));return {bytes:bytes.length,checksumMatches:hash===m.attachment.checksum};`);
  if(content.bytes!==media.bytes||!content.checksumMatches)throw Error('File integrity mismatch');
  records.push({from,to,id:media.id});console.log(JSON.stringify({test:label,...content,deliveryObservedMs:d.elapsedMs}));
 }
 const network=t=>run(t,`const s=get('src/composition/neuronRuntime.ts').localAccountNetworkSnapshot();return s?{state:s.state,connections:s.pool?.connections?.map(c=>({route:c.route,state:c.state}))}:null;`);
 // Return only transport/state metadata, not identity histories or message contents.
 const before=await network(b);console.log(JSON.stringify({test:'Emulator network before restart',network:before}));
 execFileSync(adb,['-s',serial,'shell','am','force-stop','com.axonic']);
 const queued=await run(a,`return messaging.sendText(${quote(bb.account)},${quote('[DEV TEST] Queued while emulator stopped '+stamp)});`);
 console.log(JSON.stringify({test:'Offline enqueue',state:await state(a,bb.account,queued,'outgoing')}));
 execFileSync(adb,['-s',serial,'shell','am','start','-a','android.intent.action.VIEW','-d','axonic://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081','-p','com.axonic']);
 b=(await until(async()=>(await targets()).find(t=>t.appId==='com.axonic'&&t.deviceName.startsWith('sdk_gphone64_x86_64')),'Emulator reconnect')).value;
 await until(async()=>{try{return (await inspect(b)).account===bb.account;}catch{return false;}},'Same emulator identity restored');
 const d=await delivery(a,b,aa.account,bb.account,queued);records.push({from:aa.account,to:bb.account,id:queued});
 for(const r of records){const sender=r.from===aa.account?a:b,receiver=r.from===aa.account?b:a;const [s,v]=await Promise.all([state(sender,r.to,r.id,'outgoing'),state(receiver,r.from,r.id,'incoming')]);if(s.length!==1||v.length!==1)throw Error('Missing or duplicate message after reconnect');}
 const [afterA,afterB]=await Promise.all([inspect(a),inspect(b)]);
 if(afterA.count<aa.count+records.length||afterB.count<bb.count+records.length)throw Error('Unexpected message count after test');
 if(!aa.keys.every(k=>afterA.keys.includes(k))||!bb.keys.every(k=>afterB.keys.includes(k)))throw Error('An existing message record is missing');
 console.log(JSON.stringify({test:'Restart and queued delivery',delivered:true,deliveryObservedMs:d.elapsedMs,sameIdentity:true,allTestMessagesExactlyOnce:true,finalMessageCounts:[afterA.count,afterB.count],network:await network(b)}));
 console.log(JSON.stringify({passed:true,normalPhoneAppUntouched:true,resetOrDeletion:false}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
