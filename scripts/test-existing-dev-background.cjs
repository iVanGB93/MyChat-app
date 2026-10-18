// Authorized real-media Dev-to-Dev background check, not a Doze/release test.
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {run}=require('./test-two-phone-dev.cjs');
const q=JSON.stringify,wait=ms=>new Promise(r=>setTimeout(r,ms));
const adb='C:/Users/iVan/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const report={utc:new Date().toISOString()},output='builds/existing-dev-background-'+Date.now()+'.json';
async function main(){
 const base=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),photo=process.argv[3];if(!photo)throw Error('Visually verified photo name required');
 const ts=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev');
 const [a,b]=base.phones.map(d=>({...d,t:ts.find(t=>t.id.split('-')[0]===d.target.split('-')[0])}));if(!a.t||!b.t)throw Error('Both Dev accounts required');
 for(const d of [a,b])await run(d.t,`if(account.status().account!==${q(d.owner)}||account.status().state!=='unlocked')throw Error('Wrong Dev account');return true;`);
 const notices=()=>run(b.t,`const nf=find(/@notifee.*[\\/]index\\.(ts|js)$/).default;return (await nf.getDisplayedNotifications()).map(n=>n.notification).filter(n=>n.data?.sender===${q(a.owner)}&&n.data?.type==='root_neuron_message').map(n=>({id:n.id,messageId:n.data.messageId,generic:!n.data.messagePreviews}));`);
 report.notificationsBefore=(await notices()).length;
 try{
  execFileSync(adb,['-s','R3GL10CNS1K','shell','input','keyevent','3']);
  await wait(35000);
  report.receiverBackground=await run(b.t,`return find(/react-native[\\/]index\\.js$/).AppState.currentState!=='active';`);
  if(!report.receiverBackground)throw Error('Receiver is not backgrounded');
  const start=performance.now();
  report.messageId=await run(a.t,`const m=(await ledger().snapshot()).messages.find(m=>m.peer===${q(b.owner)}&&m.attachment?.name===${q(photo)}&&!m.group);if(!m)throw Error('Existing photo missing');const f=get('src/services/identity/rootAttachmentFiles.ts').rootAttachmentFile(account.status().account,get('src/services/identity/attachmentProtocol.ts').attachmentDigest(m.attachment.manifest));return get('src/services/identity/rootAttachmentRuntime.ts').queueRootAttachmentSource(${q(b.owner)},f.uri,m.attachment.name,m.attachment.mime,account.status().account);`);
  let shown;
  while(performance.now()-start<60000){const n=await notices();if(n.some(x=>x.messageId===report.messageId&&!x.generic)){shown=n;break;}await wait(600);}
  if(!shown)throw Error('Expected background preview not observed');
  report.previewObservedMs=Math.round(performance.now()-start);
  report.matchingPreviews=shown.filter(n=>n.messageId===report.messageId&&!n.generic).length;
  report.genericNotifications=shown.filter(n=>n.generic).length;
  report.completed=report.matchingPreviews===1&&report.genericNotifications===0;
  if(!report.completed)throw Error('Unexpected duplicate/generic notifications');
 }finally{
  execFileSync(adb,['-s','R3GL10CNS1K','shell','am','start','-n','com.axonic.dev/com.axonic.MainActivity']);
 }
}
main().catch(e=>{report.error=e.message;console.error(e.message);process.exitCode=1;}).finally(()=>{fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,output,messageId:undefined}));});
