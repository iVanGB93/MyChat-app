const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
const compile=p=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:1,target:9}}).outputText;
function fixture(){
 let now=0,seq=0,writeListener,accountListener,appListener,locked=false,failSave=false,blockRead;
 const timers=new Map(),disk=new Map(),links=new Map();const counts={snapshots:0,available:0,saves:0};
 const state={contacts:[{account:'peer',accepted:true}],messages:[]},AppState={currentState:'active',addEventListener:(_,f)=>{appListener=f;return {remove(){}};}};
 const exports_={},pump={},exporter={};
 new Function('exports','setTimeout','clearTimeout',compile('src/services/workPump.ts'))(pump,(fn,delay)=>{timers.set(++seq,{fn,at:now+delay});return seq;},id=>timers.delete(id));
 new Function('exports','require',compile('src/services/identity/receivedMediaExport.ts'))(exporter,n=>n==='./attachmentProtocol'?{attachmentDigest:m=>m.id}:{IMPORTED_STICKER_CONTENT:'sticker'});
 const deps={
  expo:{requireOptionalNativeModule:()=>({supported:true,available:async()=>{counts.available++;return true;},save:async()=>{if(failSave)throw Error('disk');counts.saves++;return 'content://'+counts.saves;},deleteOwned:async()=>{throw Error('No real deletion permitted');}})},
  'expo-file-system':{},'expo-file-system/legacy':{},'react-native':{AppState,Platform:{OS:'android'}},
  '@react-native-async-storage/async-storage':{default:{getItem:async key=>disk.get(key),setItem:async(key,value)=>{disk.set(key,value);}}},
  './localAccount':{localAccount:{status:()=>({account:'owner',state:locked?'locked':'unlocked'}),subscribe:f=>{accountListener=f;return()=>{};}}},
  './localRootChat':{localRootChat:()=>({snapshot:async()=>{counts.snapshots++;if(blockRead)await blockRead;return state;}})},
  './rootChatActions':{rootChatView:(_,s)=>s},
  './rootAttachmentFiles':{rootAttachmentFile:()=>({exists:true,uri:'file://synthetic'}),rootAttachmentExportLink:(_,d)=>links.get(d),linkRootAttachmentExport:(_,d,u)=>links.set(d,u)},
  './receivedMediaExport':exporter,'../workPump':pump,'../../modules/storage/chatStore':{subscribeOwnChatWrites:f=>{writeListener=f;return()=>{};}},
 };
 new Function('exports','require','Date',compile('src/services/identity/rootMediaExport.ts'))(exports_,n=>deps[n]??{},{now:()=>now});
 const runtime=exports_.startRootMediaExport();
 async function advance(ms){const end=now+ms;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn();for(let n=0;n<200;n++)await Promise.resolve();}now=end;}
 function add(id){state.messages.push({id,peer:'peer',direction:'incoming',status:'delivered',attachment:{name:'synthetic.jpg',mime:'image/jpeg',manifest:{id}}});}
 return {runtime,advance,counts,add,state,write:()=>writeListener('owner'),otherWrite:()=>writeListener('other'),exports_,fail:v=>failSave=v,
  lock(v){locked=v;accountListener();},foreground(v){AppState.currentState=v?'active':'background';appListener(AppState.currentState);},block(p){blockRead=p;}};
}
test('quiet exporter performs 10 snapshots in 30 minutes instead of 121',async t=>{
 const f=fixture();t.after(()=>f.runtime.stop());await f.advance(1800000);assert.equal(f.counts.snapshots,10);
 f.otherWrite();await f.advance(0);assert.equal(f.counts.snapshots,10);
 f.add('a');f.write();await f.advance(0);assert.equal(f.counts.saves,1);
});
test('new media and preference changes wake immediately; existing links avoid native rechecks',async t=>{
 const f=fixture();t.after(()=>f.runtime.stop());f.add('a');await f.advance(0);assert.equal(f.counts.available,1);
 for(let i=0;i<10;i++){f.write();await f.advance(0);}assert.equal(f.counts.available,1);assert.equal(f.counts.saves,1);
 await f.exports_.setAutoSaveReceivedMedia(false);f.add('b');await f.advance(0);assert.equal(f.counts.saves,1);
 await f.exports_.setAutoSaveReceivedMedia(true);await f.advance(0);assert.equal(f.counts.saves,2);
 await f.advance(600000);assert(f.counts.available>2,'external media availability is eventually rechecked');
});
test('failed exports retry, and a backlog drains without waiting for the idle interval',async t=>{
 const f=fixture();t.after(()=>f.runtime.stop());for(let i=0;i<25;i++)f.add('photo'+i);
 f.fail(true);await f.advance(0);assert.equal(f.counts.saves,0);f.fail(false);await f.advance(15000);assert.equal(f.counts.saves,25);
});
test('background and locked accounts do not export; rapid relock invalidates in-flight work',async t=>{
 const f=fixture();t.after(()=>f.runtime.stop());f.foreground(false);f.add('a');await f.advance(60000);assert.equal(f.counts.saves,0);
 f.lock(true);f.foreground(true);await f.advance(0);assert.equal(f.counts.saves,0);
 let release;f.block(new Promise(r=>release=r));f.lock(false);await f.advance(0);f.lock(true);f.lock(false);release();
 for(let n=0;n<30;n++)await Promise.resolve();assert.equal(f.counts.saves,0,'stale generation cannot export');
 f.block(null);await f.advance(0);assert.equal(f.counts.saves,1);
});
