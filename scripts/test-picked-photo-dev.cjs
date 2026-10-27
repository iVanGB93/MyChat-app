const fs=require('node:fs'),{run,until}=require('./test-two-phone-dev.cjs');
(async()=>{
 const targets=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev'&&t.deviceName.startsWith('sdk_gphone'));
 const a=targets.find(t=>t.id.startsWith('715a96caaa960e3264b13df66c749e02bda45b9d')),b=targets.find(t=>t!==a);if(!a||!b)throw Error('Need two Dev emulators');
 const picker=JSON.parse(fs.readFileSync('builds/single-copy-picker-result.json','utf8'));
 const peer=await run(b,`return account.status().account;`);
 const id=await run(a,`const owner=account.status().account;return get('src/services/identity/rootMediaExport.ts').withRootPickedMedia([{uri:${JSON.stringify(picker.selectedUri)},name:'single-copy-picked-photo.png',mime:'image/png'}],items=>get('src/services/identity/rootAttachmentSelections.ts').queueRootAttachmentBatch({owner,peer:${JSON.stringify(peer)},items}));`);
 const result=(await until(async()=>run(a,`const m=(await ledger().snapshot()).messages.find(m=>m.id===${JSON.stringify(id)}&&m.direction==='outgoing');if(m?.status!=='delivered'||!m.attachment)return null;const d=get('src/services/identity/attachmentProtocol.ts').attachmentDigest(m.attachment.manifest),f=get('src/services/identity/rootAttachmentFiles.ts').rootAttachmentFile(account.status().account,d);if(f.uri!==${JSON.stringify(picker.selectedUri)})return null;const dimensions=await find(/react-native[\\/]index\\.js$/).Image.getSize(f.uri);return {id:m.id,uri:f.uri,dimensions};`),'Picked original reused after delivery',120000)).value;
 fs.writeFileSync('builds/single-copy-picked-send-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
