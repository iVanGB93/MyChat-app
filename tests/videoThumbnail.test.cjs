const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function fixture(){let status={state:'unlocked',account:'owner'},exists=true,resolve,calls=0;const out={},deps={
 'react-native':{Platform:{OS:'android'}},expo:{requireOptionalNativeModule:()=>({videoThumbnail:()=>{calls++;return new Promise(r=>resolve=r);}})},
 '../../services/identity/localAccount':{localAccount:{status:()=>status}},'../../services/identity/rootAttachmentFiles':{rootAttachmentFile:()=>({exists,uri:'file:///private/content'})}};
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/modules/storage/videoThumbnail.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>deps[n]);
 return {out,lock:()=>status={state:'locked',account:'owner'},switch:()=>status={state:'unlocked',account:'other'},missing:()=>exists=false,finish:v=>resolve(v),calls:()=>calls};
}
test('video preview is unavailable without the unlocked owner and a local file',async()=>{
 for(const configure of [f=>f.lock(),f=>f.switch(),f=>f.missing()]){const f=fixture();configure(f);assert.equal(await f.out.rootVideoThumbnail('owner','digest'),null);assert.equal(f.calls(),0);}
});
test('video frame returned after a lock or account switch is discarded',async()=>{
 for(const configure of [f=>f.lock(),f=>f.switch()]){const f=fixture(),work=f.out.rootVideoThumbnail('owner','digest');configure(f);f.finish('data:image/jpeg;base64,preview');assert.equal(await work,null);}
});
test('current unlocked owner receives the local video preview',async()=>{
 const f=fixture(),work=f.out.rootVideoThumbnail('owner','digest');f.finish('data:image/jpeg;base64,preview');assert.equal(await work,'data:image/jpeg;base64,preview');
});
