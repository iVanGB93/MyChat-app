const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function fixture(mode){
 const timers=[],events=[];let release,lookupCount=0,prepares=0,listener,locked=false;
 const gate=new Promise(r=>release=r),owner='axonic:1:'+'a'.repeat(64),peer='axonic:1:'+'b'.repeat(64);
 const selection={id:'c'.repeat(64),peer,name:'test',mime:'image/jpeg',failed:false};
 let rows=[selection];
 const incoming={manifest:{expires:Date.now()+60000}};
 const snapshot={contacts:[{account:peer,accepted:true}],messages:[{peer,status:'pending',direction:'incoming',attachment:incoming}]};
 const worker={enqueue:async(_,direction)=>events.push(direction),tick:async()=>{events.push('tick');return false;},invalidate(){},stop(){},cancel(){},retry(){}};
 const deps={
 './localAccount':{localAccount:{status:()=>({account:owner,state:locked?'locked':'unlocked'}),subscribe:f=>{listener=f;return()=>{};}}},
 './localRootChat':{localRootChat:()=>({snapshot:async()=>snapshot,enqueueAttachment:async()=>events.push('publish')})},
 './attachmentPolicy':{indexAttachmentPolicy:()=>()=>true},
 './attachmentTiming':{createAttachmentTiming:()=>({measure:(_s,f)=>f(),snapshot:()=>({})})},
 './rootMediaExport':{startRootMediaExport:()=>({stop(){},wake(){}})},
 './identityRecordStore':{createMobileIdentityRecordStore:()=>({read:async()=>mode==='lookup'?null:{}})},
 './identityProtocol':{validAccountId:()=>true,verifyRecord:()=>true},
 './mobileAttachmentJobs':{createMobileAttachmentJobs:()=>({})},
 './attachmentTransfer':{createAttachmentTransfer:()=>worker},
 './rootAttachmentFiles':{prepareRootAttachment:async()=>{prepares++;await gate;return incoming;},removeRootAttachmentSource:()=>events.push('remove')},
 '@react-native-async-storage/async-storage':{default:{getItem:async()=>JSON.stringify(rows),setItem:async(_k,s)=>rows=JSON.parse(s)}},
 };
 const out={};new Function('require','exports','setTimeout','clearTimeout','__DEV__',ts.transpileModule(fs.readFileSync('src/services/identity/rootAttachmentRuntime.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>deps[n]??{},out,f=>{timers.push(f);return f;},()=>{},false);
 const runtime=out.startRootAttachmentRuntime({peers:()=>[],request:async()=>null,lookup:async()=>{lookupCount++;await gate;}});
 const pump=async()=>{assert(timers.length);timers.shift()();for(let n=0;n<12;n++)await new Promise(setImmediate);};
 return {runtime,events,pump,release,lock(){locked=true;listener();},lookupCount:()=>lookupCount,prepares:()=>prepares,rows:()=>rows};
}
for(const mode of ['lookup','prepare'])test(`pending ${mode} cannot block incoming transfers or start duplicate work`,async t=>{
 const f=fixture(mode);t.after(()=>{f.runtime.stop();f.release();});
 await f.pump();await f.pump();await f.pump();
 assert.equal(f.events.filter(x=>x==='incoming').length,3);assert.equal(f.events.filter(x=>x==='tick').length,3);
 assert.equal(mode==='lookup'?f.lookupCount():f.prepares(),1);
 f.release();await new Promise(setImmediate);await f.pump();
 if(mode==='lookup')assert.equal(f.lookupCount(),1,'lookup retries are backed off');
 else {assert.equal(f.events.filter(x=>x==='publish').length,1);assert.equal(f.rows().length,0);}
});
test('locking during preparation cannot publish or remove a staged attachment',async t=>{
 const f=fixture('prepare');t.after(()=>f.runtime.stop());await f.pump();f.lock();f.release();
 for(let n=0;n<6;n++)await new Promise(setImmediate);
 assert(!f.events.includes('publish'));assert(!f.events.includes('remove'));assert.equal(f.rows().length,1);
});
