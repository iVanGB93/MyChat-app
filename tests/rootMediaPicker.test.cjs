const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function setup(){
 let status={account:'owner',state:'unlocked'},permission=true,result={canceled:false,assets:[{uri:'file://photo',fileName:'picture.jpg',mimeType:'image/jpeg',fileSize:100,type:'image'}]};
 const calls=[],queued=[];
 const picker={requestCameraPermissionsAsync:async()=>{calls.push('permission');return {granted:permission};},launchCameraAsync:async options=>{calls.push(['camera',options]);return result;},launchImageLibraryAsync:async options=>{calls.push(['library',options]);return result;}};
 const output={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/modules/ui/mediaPicker.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>({
  'expo-image-picker':picker,'../identity':{localAccount:{status:()=>status},validAccountId:x=>['owner','peer','other'].includes(x)},'../../services/identity/attachmentProtocol':{ATTACHMENT_MAX_BYTES:250*1024*1024},'../messaging':{queueRootAttachmentSource:async(...args)=>{queued.push(args);return 'selection';}}
 }[name]),output);
 return {output,picker,calls,queued,status,setResult:v=>result=v,setPermission:v=>permission=v};
}
test('camera queues typed media under the initiating owner',async()=>{const f=setup();assert.equal(await f.output.pickRootMedia('peer','camera'),'selection');assert.equal(f.calls[0],'permission');assert.deepEqual(f.queued[0],['peer','file://photo','picture.jpg','image/jpeg','owner',undefined]);});
test('gallery uses system selection without requesting broad library access',async()=>{const f=setup();await f.output.pickRootMedia('peer','library');assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'library');assert.deepEqual(f.calls[0][1].mediaTypes,['images','videos']);assert.equal(f.calls[0][1].allowsMultipleSelection,false);});
test('cancel and denied camera permission do not queue files',async()=>{const f=setup();f.setResult({canceled:true,assets:null});await f.output.pickRootMedia('peer','library');assert.equal(f.queued.length,0);f.setPermission(false);await assert.rejects(f.output.pickRootMedia('peer','camera'),/camera access/);assert.equal(f.calls.filter(c=>Array.isArray(c)&&c[0]==='camera').length,0);});
test('lock while native picker is open permits staging for the same owner',async()=>{const f=setup();f.picker.launchImageLibraryAsync=async()=>{f.status.state='locked';return {canceled:false,assets:[{uri:'file://video',type:'video',mimeType:'video/mp4'}]};};await f.output.pickRootMedia('peer','library');assert.deepEqual(f.queued[0],['peer','file://video','Video','video/mp4','owner',undefined]);});
test('account switch while selecting cannot enqueue under the replacement account',async()=>{const f=setup();f.picker.launchImageLibraryAsync=async()=>{f.status.account='other';return {canceled:false,assets:[{uri:'file://photo'}]};};await assert.rejects(f.output.pickRootMedia('peer','library'),/Account changed/);assert.equal(f.queued.length,0);});
test('oversized and missing media are rejected before staging',async()=>{const f=setup();f.setResult({canceled:false,assets:[{uri:'file://big',fileSize:251*1024*1024}]});await assert.rejects(f.output.pickRootMedia('peer','library'),/250 MiB/);f.setResult({canceled:false,assets:[]});await assert.rejects(f.output.pickRootMedia('peer','library'),/unavailable/);assert.equal(f.queued.length,0);});
test('locked entry cannot launch a picker',async()=>{const f=setup();f.status.state='locked';await assert.rejects(f.output.pickRootMedia('peer','camera'),/Unlock/);assert.equal(f.calls.length,0);});

test('reply reference survives picker lock and is handed to durable selection staging',async()=>{
 const f=setup(),reply={id:'1'.repeat(64),author:'peer'};
 f.picker.launchImageLibraryAsync=async()=>{f.status.state='locked';return {canceled:false,assets:[{uri:'file://video',type:'video',mimeType:'video/mp4'}]};};
 await f.output.pickRootMedia('peer','library',reply);assert.deepEqual(f.queued[0][5],reply);
});
