// Dev emulators only. No real contact messages or official-app writes.
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {run,until}=require('./test-two-phone-dev.cjs');
const adb='C:/Users/iVan/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const serials=['emulator-5554','emulator-5556'];
const command=(s,a)=>execFileSync(adb,['-s',s,...a],{encoding:'utf8',timeout:120000});
const targets=async()=>(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev'&&t.deviceName.startsWith('sdk_gphone'));
const inventory=t=>run(t,`return {owner:account.status().account,keys:(await ledger().snapshot()).messages.map(m=>m.peer+':'+m.direction+':'+m.id)};`);
async function main(){
 if(process.argv.includes('--install')){
  const apk='android/app/build/outputs/apk/debug/app-debug.apk';
  const badge=execFileSync('C:/Users/iVan/AppData/Local/Android/Sdk/build-tools/36.0.0/aapt.exe',['dump','badging',apk],{encoding:'utf8'});
  if(!/^package: name='com\.axonic\.dev'/m.test(badge))throw Error('Refusing non-Dev APK');
  const before=await Promise.all((await targets()).map(inventory));if(before.length!==2)throw Error('Need both emulators');
  const official=serials.map(s=>command(s,['shell','dumpsys','package','com.axonic']).split('\n').filter(l=>/versionCode=|lastUpdateTime=/.test(l)));
  fs.writeFileSync('builds/single-copy-dev-baseline-'+Date.now()+'.json',JSON.stringify({before,official}),{flag:'wx'});
  for(const s of serials){command(s,['shell','am','force-stop','com.axonic.dev']);console.log(command(s,['install','-r',apk]));command(s,['reverse','tcp:8081','tcp:8081']);command(s,['shell','am','start','-a','android.intent.action.VIEW','-d','exp+axonic-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081','-p','com.axonic.dev']);}
  await until(async()=>{try{const after=await Promise.all((await targets()).map(inventory));return after.length===2&&before.every(b=>after.some(a=>a.owner===b.owner&&b.keys.every(k=>a.keys.includes(k))));}catch{return false;}},'Preserved Dev identities and messages',120000);
  for(let i=0;i<serials.length;i++)if(JSON.stringify(official[i])!==JSON.stringify(command(serials[i],['shell','dumpsys','package','com.axonic']).split('\n').filter(l=>/versionCode=|lastUpdateTime=/.test(l))))throw Error('Official app changed');
 }
 const results=[];
 for(const t of await targets()){
  const result=await run(t,`
   const fs=find(/expo-file-system[\\/]src[\\/]index\\.ts$/);
   const native=get('src/services/identity/sharedMediaFile.ts').sharedMediaNative;
   const media=find(/expo[\\/]src[\\/]Expo\\.ts$/).requireOptionalNativeModule('AxonicMediaStore');
   if(!native?.singleCopy||!media.adopt)throw Error('Rebuild Dev first');
   const files=get('src/services/identity/rootAttachmentFiles.ts'),owner=account.status().account;
   if(account.status().state!=='unlocked')throw Error('Unlock Dev');
   const id=await find(/modules[\\/]axonic-nearby[\\/]index\\.ts$/).default.identityRandomBytes(32);
   const directory=new fs.Directory(fs.Paths.document,'axonic-own-attachments-v1',owner.slice(9),'files',id);directory.create({intermediates:true});
   const source=new fs.File(directory,'content');source.write(new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]));
   const cache=new fs.File(directory,'0.block'),proof=new fs.File(directory,'0.proof'),metadata=new fs.File(directory,'test-metadata.json');cache.write('synthetic');proof.write('synthetic');metadata.write('{}');
   const uri=await media.save(source.uri,'AXN_'+id+'__single-copy-test.bin','application/octet-stream','document');
   await files.adoptRootAttachmentExport(owner,id,uri);
   if(source.exists)throw Error('Private duplicate retained');
   if(cache.exists||proof.exists||!metadata.exists)throw Error('Own transport cache cleanup scope failed');
   const canonical=files.rootAttachmentFile(owner,id);
   if(canonical.uri!==uri||!canonical.exists||canonical.size!==12)throw Error('Canonical reference failed');
   const reader=canonical.open();const bytes=reader.readBytes(8);reader.offset=8;const tail=reader.readBytes(4);reader.close();
   if(bytes.length!==8||bytes[0]!==137||tail.join(',')!=='1,2,3,4')throw Error('Seek/read mismatch');
   const checksum=await files.hashRootAttachmentFile(owner,id,12);
   if(!/^[a-f0-9]{64}$/.test(checksum))throw Error('Hash failed');
   // Simulate a crash after reference commit but before duplicate removal.
   source.write(new Uint8Array([99]));await files.adoptRootAttachmentExport(owner,id,uri);if(source.exists)throw Error('Crash cleanup failed');
   if(await media.deleteOwned(uri,id)!=='deleted')throw Error('Synthetic gallery cleanup failed');
   if(files.rootAttachmentFile(owner,id).exists)throw Error('External deletion ignored');
   await files.adoptRootAttachmentExport(owner,id,uri);
   if(source.exists||files.rootAttachmentFile(owner,id).exists)throw Error('Deleted file resurrected');
   // Remove only this newly-created synthetic metadata directory.
   directory.delete();
   return {owner,singleCopy:true,seekRead:true,hash:true,crashRecovery:true,ownTransportCacheRemoved:true,metadataPreserved:true,externalDeletionRespected:true,syntheticMediaRemoved:true};
  `);
  results.push(result);console.log(JSON.stringify(result));
 }
 if(results.length!==2)throw Error('Need two emulator results');
 const baseline=JSON.parse(fs.readFileSync('builds/single-copy-dev-baseline.json','utf8'));
 const after=await Promise.all((await targets()).map(inventory));
 if(!baseline.before.every(b=>after.some(a=>a.owner===b.owner&&b.keys.every(k=>a.keys.includes(k)))))throw Error('Preservation baseline mismatch');
 for(let i=0;i<serials.length;i++)if(JSON.stringify(baseline.official[i])!==JSON.stringify(command(serials[i],['shell','dumpsys','package','com.axonic']).split('\n').filter(l=>/versionCode=|lastUpdateTime=/.test(l))))throw Error('Official app changed');
 fs.writeFileSync('builds/single-copy-device-result.json',JSON.stringify({at:new Date().toISOString(),results,baselineMessagesPreserved:true,officialAppsUnchanged:true},null,2));
 console.log('Both Dev identities and baseline messages preserved; official apps unchanged.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
