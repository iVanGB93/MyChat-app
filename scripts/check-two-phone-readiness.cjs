// Read-only inventory of the two authorized Dev apps. Never clears app data,
// changes contacts, acknowledges messages, generates fixtures, or sends traffic.
const fs=require('node:fs'),crypto=require('node:crypto');
const {run}=require('./test-two-phone-dev.cjs');
const devices=[{label:'A',prefix:'737378d0'},{label:'B',prefix:'c105964d'}];
async function main(){
 const targets=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev');
 const report={utc:new Date().toISOString(),phones:[]};
 for(const d of devices){
  const t=targets.find(t=>t.id.startsWith(d.prefix));if(!t)throw Error('Both Dev apps must be connected');
  const result=await run(t,`
   const s=account.status();if(s.state!=='unlocked'||s.busy)throw Error('Dev must be unlocked');
   const v=get('src/services/identity/rootChatActions.ts').rootChatView(s.account,await ledger().snapshot());
   const files=get('src/services/identity/rootAttachmentFiles.ts'),protocol=get('src/services/identity/attachmentProtocol.ts');
   const media=v.messages.filter(m=>m.attachment&&!m.deleted).map(m=>{
    const a=m.attachment,f=files.rootAttachmentFile(s.account,protocol.attachmentDigest(a.manifest));
    return {id:m.id,peer:m.peer,direction:m.direction,status:m.status,mime:a.mime,bytes:a.manifest.bytes,
     realMedia:/^(image|video|audio)\\//.test(a.mime)&&!/(dev.test|benchmark|synthetic|comparison|fixture)/i.test(a.name),
     exists:f.exists,size:f.exists?f.size:null};
   });
   const n=get('src/composition/neuronRuntime.ts').localAccountNetworkSnapshot();
   return {owner:s.account,keys:v.messages.map(m=>m.peer+':'+m.direction+':'+m.id),media,
    network:{connections:n.pool?.connections?.map(c=>({state:c.state,route:c.route})),rtc:n.rtc?.map(c=>({open:c.open}))},
    testGlobals:['__phoneAB','__axonicTransferComparison'].filter(k=>globalThis[k])};
  `);
  report.phones.push({label:d.label,target:t.id,...result});
  console.log(JSON.stringify({phone:d.label,messages:result.keys.length,media:result.media.length,
   realMedia:result.media.map((m,index)=>({index,...m})).filter(m=>m.realMedia).map(({id,peer,...m})=>m),
   unavailable:result.media.filter(m=>!m.exists).length,testGlobals:result.testGlobals,network:result.network}));
 }
 const output='builds/dev-readiness-inventory-'+Date.now()+'.json';fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify({output,sha256:crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex')}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
