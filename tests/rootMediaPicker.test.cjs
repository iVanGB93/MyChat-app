const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function setup(){
 let status={account:'owner',state:'unlocked'},permission=true,microphone=true,result={canceled:false,assets:[{uri:'file://photo',fileName:'picture.jpg',mimeType:'image/jpeg',fileSize:100,type:'image'}]};
 const calls=[],queued=[];
 const picker={requestCameraPermissionsAsync:async()=>{calls.push('permission');return {granted:permission};},launchCameraAsync:async options=>{calls.push(['camera',options]);return result;},launchImageLibraryAsync:async options=>{calls.push(['library',options]);return result;}};
 const output={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/modules/ui/mediaPicker.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>({
  'expo-image-picker':picker,'expo-audio':{AudioModule:{getRecordingPermissionsAsync:async()=>({granted:microphone}),requestRecordingPermissionsAsync:async()=>({granted:microphone})}},'../../localization/language':{t:text=>text},'../identity':{localAccount:{status:()=>status},validAccountId:x=>['owner','peer','other'].includes(x)},'../../services/identity/attachmentProtocol':{ATTACHMENT_MAX_BYTES:250*1024*1024},'../media':{queueRootAttachmentBatch:async input=>{for(const a of input.items)queued.push([input.peer,a.uri,a.name,a.mime,input.owner,input.reply,a.caption]);return 'selection';}}
 }[name]??(name==='../storage'?{pickRootSharedMedia:()=>undefined,withRootPickedMedia:async(items,work)=>work(items)}:undefined)),output);
 return {output,picker,calls,queued,status,setResult:v=>result=v,setPermission:v=>permission=v,setMicrophone:v=>microphone=v};
}
test('camera queues typed media under the initiating owner',async()=>{const f=setup();assert.equal(await f.output.pickRootMedia('peer','camera'),'selection');assert.equal(f.calls[0],'permission');assert.deepEqual(f.queued[0],['peer','file://photo','picture.jpg','image/jpeg','owner',undefined,undefined]);});
test('gallery uses system selection without requesting broad library access',async()=>{const f=setup();await f.output.pickRootMedia('peer','library');assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'library');assert.deepEqual(f.calls[0][1].mediaTypes,['images','videos']);assert.equal(f.calls[0][1].allowsMultipleSelection,true);});
test('cancel and denied camera permission do not queue files',async()=>{const f=setup();f.setResult({canceled:true,assets:null});await f.output.pickRootMedia('peer','library');assert.equal(f.queued.length,0);f.setPermission(false);await assert.rejects(f.output.pickRootMedia('peer','camera'),/camera access/);assert.equal(f.calls.filter(c=>Array.isArray(c)&&c[0]==='camera').length,0);});
test('lock while native picker is open permits staging for the same owner',async()=>{const f=setup();f.picker.launchImageLibraryAsync=async()=>{f.status.state='locked';return {canceled:false,assets:[{uri:'file://video',type:'video',mimeType:'video/mp4'}]};};await f.output.pickRootMedia('peer','library');assert.deepEqual(f.queued[0],['peer','file://video','Video','video/mp4','owner',undefined,undefined]);});
test('account switch while selecting cannot enqueue under the replacement account',async()=>{const f=setup();f.picker.launchImageLibraryAsync=async()=>{f.status.account='other';return {canceled:false,assets:[{uri:'file://photo'}]};};await assert.rejects(f.output.pickRootMedia('peer','library'),/Account changed/);assert.equal(f.queued.length,0);});
test('oversized and missing media are rejected before staging',async()=>{const f=setup();f.setResult({canceled:false,assets:[{uri:'file://big',fileSize:251*1024*1024}]});await assert.rejects(f.output.pickRootMedia('peer','library'),/250 MiB/);f.setResult({canceled:false,assets:[]});await assert.rejects(f.output.pickRootMedia('peer','library'),/unavailable/);assert.equal(f.queued.length,0);});
test('locked entry cannot launch a picker',async()=>{const f=setup();f.status.state='locked';await assert.rejects(f.output.pickRootMedia('peer','camera'),/Unlock/);assert.equal(f.calls.length,0);});

test('preview waits for confirmation and cancellation never stages media',async()=>{
 const f=setup();let finish,shown;
 const task=f.output.pickRootMedia('peer','library',undefined,undefined,draft=>{shown=draft;return new Promise(resolve=>finish=resolve);});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(shown[0].uri,'file://photo');assert.equal(shown[0].mime,'image/jpeg');assert.equal(f.queued.length,0);
 finish(null);await task;assert.equal(f.queued.length,0);
 await f.output.pickRootMedia('peer','library',undefined,undefined,async drafts=>drafts);assert.equal(f.queued.length,1);
});

test('account changes while preview is open cannot send under a different identity',async()=>{
 const f=setup();await assert.rejects(f.output.pickRootMedia('peer','library',undefined,undefined,async drafts=>{f.status.account='other';return drafts;}),/Account changed/);
 assert.equal(f.queued.length,0);
});

test('reviewed multiple media preserve edits, removal and captions in the queued batch',async()=>{
 const f=setup();f.setResult({canceled:false,assets:[{uri:'file://one',mimeType:'image/jpeg'},{uri:'file://two',mimeType:'video/mp4',type:'video'}]});
 await f.output.pickRootMedia('peer','library',undefined,undefined,async drafts=>[{...drafts[0],uri:'file://edited',caption:'A comment'}]);
 assert.equal(f.queued.length,1);assert.equal(f.queued[0][1],'file://edited');assert.equal(f.queued[0][6],'A comment');
});

test('reply reference survives picker lock and is handed to durable selection staging',async()=>{
 const f=setup(),reply={id:'1'.repeat(64),author:'peer'};
 f.picker.launchImageLibraryAsync=async()=>{f.status.state='locked';return {canceled:false,assets:[{uri:'file://video',type:'video',mimeType:'video/mp4'}]};};
 await f.output.pickRootMedia('peer','library',reply);assert.deepEqual(f.queued[0][5],reply);
});

test('in-app camera bypasses system capture confirmation and waits for Axonic preview',async()=>{const f=setup();let previews=0;const result=await f.output.pickRootMedia('peer','camera',undefined,undefined,async drafts=>{previews++;assert.equal(f.queued.length,0);return drafts;},async()=>({canceled:false,assets:[{uri:'file://capture',fileName:'Photo.jpg',mimeType:'image/jpeg',fileSize:100}]}));assert.equal(result,'selection');assert.equal(previews,1);assert.equal(f.calls.some(c=>Array.isArray(c)&&c[0]==='camera'),false);assert.equal(f.queued[0][1],'file://capture');});
test('in-app capture cancellation and account change never send',async()=>{const f=setup();await f.output.pickRootMedia('peer','camera',undefined,undefined,undefined,async()=>({canceled:true,assets:null}));assert.equal(f.queued.length,0);await assert.rejects(f.output.pickRootMedia('peer','camera',undefined,undefined,undefined,async()=>{f.status.account='other';return {canceled:false,assets:[{uri:'file://capture'}]};}),/Account changed/);assert.equal(f.queued.length,0);});
test('chat video capture requests microphone access and uses the ordinary review flow',async()=>{
 const f=setup();let captures=0;
 const capture=async mode=>{captures++;assert.equal(mode,'video');return {canceled:false,assets:[{uri:'file://clip',type:'video',mimeType:'video/mp4'}]};};
 f.setMicrophone(false);
 await assert.rejects(f.output.pickRootMedia('peer','camera-video',undefined,undefined,undefined,capture),/microphone/);
 assert.equal(captures,0);
 f.setMicrophone(true);
 const review=async drafts=>{assert.equal(f.queued.length,0);assert.equal(drafts[0].mime,'video/mp4');return drafts;};
 assert.equal(await f.output.pickRootMedia('peer','camera-video',undefined,undefined,review,capture),'selection');
 assert.equal(captures,1);
});
