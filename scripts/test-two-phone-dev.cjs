// Explicit, authorized live test between two Dev accounts only. No normal app,
// other contact, history deletion, call initiation, reset or credentials access.
const ts=require('typescript'),WebSocket=require('ws');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:1,target:1,downlevelIteration:true}}).outputText;
const prefix=`const get=name=>{const e=[...__r.getModules()].find(([id,m])=>m.verboseName===name);if(!e)throw Error('Missing module '+name);return __r(e[0]);};const find=pattern=>{const e=[...__r.getModules()].find(([id,m])=>pattern.test(m.verboseName));if(!e)throw Error('Missing native dependency');return __r(e[0]);};const account=get('src/services/identity/localAccount.ts').localAccount;const ledger=()=>get('src/services/identity/localRootChat.ts').localRootChat();const messaging=get('src/modules/messaging/index.ts').messaging;`;
function evaluate(t,expression){return new Promise((resolve,reject)=>{const ws=new WebSocket(t.webSocketDebuggerUrl),timer=setTimeout(()=>{ws.close();reject(Error('Dev debugger timeout'));},15000);ws.on('open',()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}})));ws.on('error',e=>{clearTimeout(timer);reject(e);});ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id!==1)return;clearTimeout(timer);ws.close();if(m.result?.exceptionDetails)reject(Error('Dev evaluation exception'));else resolve(m.result?.result?.value);});});}
async function run(t,code){await evaluate(t,compile(`(()=>{globalThis.__twoPhoneTest={pending:true};(async()=>{${prefix}${code}})().then(value=>globalThis.__twoPhoneTest={value},e=>globalThis.__twoPhoneTest={error:String(e)});return true;})()`));for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,150));const s=await evaluate(t,'globalThis.__twoPhoneTest');if(s&&!s.pending){await evaluate(t,'delete globalThis.__twoPhoneTest');if(s.error)throw Error(s.error);return s.value;}}throw Error('Dev operation timeout');}
async function until(check,label,ms=60000){const began=Date.now();while(Date.now()-began<ms){const v=await check();if(v)return {elapsedMs:Date.now()-began,value:v};await new Promise(r=>setTimeout(r,1200));}throw Error(label+' timed out');}
async function main(){
 const ids=process.argv.slice(2,4);if(ids.length!==2||ids[0]===ids[1])throw Error('Supply two distinct Dev target IDs');
 const available=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev');
 const [a,b]=ids.map(id=>available.find(t=>t.id===id));if(!a||!b)throw Error('Both targets must be connected com.axonic.dev');
 const identity=async t=>run(t,`const s=account.status();if(s.state!=='unlocked'||s.busy)throw Error('Unlock Dev before testing');return s.account;`);
 const [aa,bb]=await Promise.all([identity(a),identity(b)]);if(aa===bb)throw Error('Dev identities must differ');
 for(const [t,peer] of [[a,bb],[b,aa]])await run(t,`const c=(await ledger().snapshot()).contacts.find(c=>c.account===${JSON.stringify(peer)});if(c?.blocked)throw Error('Dev test peer is blocked');if(!c?.accepted)await ledger().configure(${JSON.stringify(peer)},{accepted:true});return true;`);
 const stamp=new Date().toISOString(),results=[];
 const state=async(t,peer,id,direction)=>run(t,`const s=get('src/services/identity/rootChatActions.ts').rootChatView(account.status().account,await ledger().snapshot());const m=s.messages.find(m=>m.peer===${JSON.stringify(peer)}&&m.id===${JSON.stringify(id)}&&m.direction===${JSON.stringify(direction)});return m?{status:m.status,read:!!m.read,attachment:!!m.attachment}:null;`);
 if(process.argv[4]==='background'){
  await run(b,`if(find(/react-native[\\/]index\\.js$/).AppState.currentState==='active')throw Error('Background the second Dev app first');return true;`);
  const notices=(t,peer)=>run(t,`const nf=find(/@notifee.*[\\/]index\\.(ts|js)$/).default;return (await nf.getDisplayedNotifications()).map(n=>n.notification).filter(n=>n.data?.sender===${JSON.stringify(peer)}&&n.data?.type==='root_neuron_message').map(n=>({id:n.id,messageId:n.data.messageId,generic:!n.data.messagePreviews}));`);
  const before=await notices(a,bb);
  const id=await run(a,`return messaging.sendText(${JSON.stringify(bb)},${JSON.stringify('[DEV TEST] Background delivery '+stamp)});`);
  const delivery=await until(async()=>{const [s,r]=await Promise.all([state(a,bb,id,'outgoing'),state(b,aa,id,'incoming')]);return s?.status==='delivered'&&r?.status==='delivered';},'Background delivery');
  const shown=await until(async()=>{const ns=await notices(b,aa);return ns.some(n=>n.messageId===id&&!n.generic)?ns:null;},'OS preview notification');
  if(shown.value.filter(n=>n.messageId===id).length!==1||shown.value.some(n=>n.generic))throw Error('Extra or generic notification for test conversation');
  // Reading through a foreground chat is distinct from a notification action's
  // headless lease. Do not bypass that lifecycle by calling readMessages in background.
  const serial=process.argv[5];if(!/^[A-Za-z0-9-]+$/.test(serial??''))throw Error('Supply receiver Dev phone serial for foreground read test');
  require('node:child_process').execFileSync('C:/Users/iVan/AppData/Local/Android/Sdk/platform-tools/adb.exe',['-s',serial,'shell','am','start','-n','com.axonic.dev/com.axonic.MainActivity'],{stdio:'pipe'});
  await until(async()=>run(b,`return find(/react-native[\\/]index\\.js$/).AppState.currentState==='active';`),'Dev foreground');
  await run(b,`await messaging.readMessages(${JSON.stringify(aa)},[${JSON.stringify(id)}]);return true;`);
  await until(async()=>(await state(a,bb,id,'outgoing'))?.read,'Background read receipt');
  const after=await notices(a,bb);if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Receipt changed sender notification');
  console.log(JSON.stringify({passed:true,test:'Background delivery then foreground read',deliveryObservedMs:delivery.elapsedMs,oneOSPreview:true,genericNotifications:0,receiptAddedNoNotification:true}));return;
 }
 for(const [sender,receiver,from,to,label] of [[a,b,aa,bb,'A to B'],[b,a,bb,aa,'B to A']]){
  const id=await run(sender,`return messaging.sendText(${JSON.stringify(to)},${JSON.stringify('[DEV TEST] Pre-release '+label+' '+stamp)});`);
  const delivered=await until(async()=>{const [s,r]=await Promise.all([state(sender,to,id,'outgoing'),state(receiver,from,id,'incoming')]);return s?.status==='delivered'&&r?.status==='delivered'?true:false;},label+' delivery');
  await run(receiver,`await messaging.readMessages(${JSON.stringify(from)},[${JSON.stringify(id)}]);return true;`);
  const read=await until(async()=>(await state(sender,to,id,'outgoing'))?.read,label+' read');
  results.push({test:label,delivered:true,read:true,deliveryObservedMs:delivered.elapsedMs,readObservedMs:read.elapsedMs});console.log(JSON.stringify(results.at(-1)));
 }
 const media=await run(a,`const fs=find(/expo-file-system.*index\\.(ts|js)$/);const name='dev-prerelease-'+Date.now()+'.txt';const f=new fs.File(fs.Paths.cache,name);f.create();const text='[DEV TEST] Synthetic media delivery.\\n'.repeat(512);f.write(text);const id=await get('src/services/identity/rootAttachmentRuntime.ts').queueRootAttachmentSource(${JSON.stringify(bb)},f.uri,name,'text/plain');return {id,bytes:new TextEncoder().encode(text).length};`);
 const transferred=await until(async()=>{const [s,r]=await Promise.all([state(a,bb,media.id,'outgoing'),state(b,aa,media.id,'incoming')]);return s?.status==='delivered'&&r?.status==='delivered';},'Media delivery',90000);
 const content=await run(b,`const m=(await ledger().snapshot()).messages.find(m=>m.id===${JSON.stringify(media.id)}&&m.peer===${JSON.stringify(aa)}&&m.direction==='incoming');if(!m?.attachment)throw Error('Test attachment missing');const file=get('src/services/identity/rootAttachmentFiles.ts').rootAttachmentFile(account.status().account,get('src/services/identity/attachmentProtocol.ts').attachmentDigest(m.attachment.manifest));const bytes=file.bytesSync();const hash=get('node_modules/@noble/hashes/utils.js').bytesToHex(get('node_modules/@noble/hashes/sha2.js').sha256(bytes));return {bytes:bytes.length,checksumMatches:hash===m.attachment.checksum};`);
 if(!content.checksumMatches||content.bytes!==media.bytes)throw Error('Received test media mismatch');results.push({test:'Small file A to B',delivered:true,bytes:content.bytes,checksumMatches:true,deliveryObservedMs:transferred.elapsedMs});console.log(JSON.stringify(results.at(-1)));
 console.log(JSON.stringify({passed:true,tests:results.length,scope:'Two authorized Dev accounts; no production app, reset or history deletion'}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
