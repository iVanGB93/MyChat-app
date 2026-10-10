const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(){const status={account:'owner',state:'unlocked'},copied=[],deleted=[];let afterCopy=()=>{};
 const native={copyShared:async uri=>{copied.push(uri);afterCopy();return 'file://cache/share';}};
 class File{constructor(uri){this.uri=uri;}get exists(){return true;}delete(){deleted.push(this.uri);}}
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/rootMediaExport.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>{
  if(name==='expo')return {requireOptionalNativeModule:()=>native};if(name==='react-native')return {Platform:{OS:'android'}};
  if(name==='expo-file-system')return {File};if(name==='./localAccount')return {localAccount:{status:()=>status}};return {};
 },out);return {out,status,copied,deleted,after:fn=>afterCopy=fn};}
test('shared content is staged as a private file and temporary bytes are removed after durable queueing',async()=>{
 const f=fixture();assert.equal(await f.out.withRootSharedFile('owner','content://media/1',async uri=>{assert.equal(uri,'file://cache/share');return 'queued';}),'queued');assert.equal(f.copied.length,1);assert.deepEqual(f.deleted,['file://cache/share']);
});
test('queue failure or account change after copying preserves account isolation and removes temporary bytes',async()=>{
 for(const changed of [true,false]){const f=fixture();if(changed)f.after(()=>f.status.account='other');let called=false;await assert.rejects(f.out.withRootSharedFile('owner','content://media/1',async()=>{called=true;throw Error('Queue full');}));assert.equal(called,!changed);assert.equal(f.deleted.length,1);}
});
test('ordinary private files are not copied or deleted and locked entry cannot import',async()=>{
 const f=fixture();await f.out.withRootSharedFile('owner','file://original',async uri=>assert.equal(uri,'file://original'));assert.equal(f.deleted.length,0);f.status.state='locked';await assert.rejects(f.out.withRootSharedFile('owner','content://media/1',async()=>{}));assert.equal(f.copied.length,0);
});
