// Synthetic fixtures only; native SHA-256 compared with independent Node crypto.
const {run,until}=require('./test-two-phone-dev.cjs');
const {execFileSync}=require('node:child_process');
const crypto=require('node:crypto'),fs=require('node:fs');
const adb='C:/Users/iVan/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const targets=async()=>(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev');
const inspect=t=>run(t,`const s=account.status();if(s.state!=='unlocked'||s.busy)throw Error('Not ready');return {owner:s.account,keys:(await ledger().snapshot()).messages.map(m=>m.peer+':'+m.direction+':'+m.id)};`);
async function main(){
 if(process.argv.includes('--update-emulator')){
  const select=ts=>ts.find(t=>t.id.startsWith('715a96caaa960e3264b13df66c749e02bda45b9d-'));
  const t=select(await targets());if(!t)throw Error('Emulator Dev unavailable');const before=await inspect(t);
  const apk='android/app/build/outputs/apk/debug/app-debug.apk';
  const badge=execFileSync('C:/Users/iVan/AppData/Local/Android/Sdk/build-tools/36.0.0/aapt.exe',['dump','badging',apk],{encoding:'utf8'});
  if(!/^package: name='com\.axonic\.dev'/m.test(badge)||!badge.includes('x86_64'))throw Error('Wrong APK');
  execFileSync(adb,['-s','emulator-5554','install','-r',apk]);
  execFileSync(adb,['-s','emulator-5554','reverse','tcp:8081','tcp:8081']);
  execFileSync(adb,['-s','emulator-5554','shell','am','start','-a','android.intent.action.VIEW','-d','exp+axonic-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081','-p','com.axonic.dev']);
  const after=(await until(async()=>{try{const n=select(await targets());return n&&await inspect(n);}catch{return null;}},'Dev restore',120000)).value;
  if(before.owner!==after.owner||before.keys.some(k=>!after.keys.includes(k)))throw Error('Baseline changed');
  console.log('Emulator Dev updated; identity/history retained');
 }
 const results=[];
 for(const t of (await targets()).filter(t=>/^(737378d|715a96c)/.test(t.id))){
  for(const bytes of [1,1_000_000,3_000_000,3_000_017,10_000_000]){
   const actual=await run(t,`const files=get('src/services/identity/rootAttachmentFiles.ts'),native=get('src/services/identity/sharedMediaFile.ts').sharedMediaNative;
    const id=${JSON.stringify(crypto.randomBytes(32).toString('hex'))};
    const file=files.createRootStreamTemporary(account.status().account,id);try{file.write(new Uint8Array(${bytes}).fill(91));const start=performance.now(),result=await native.hashBlocks(file.uri,${bytes});
     let truncated=false,extra=false;try{await native.hashBlocks(file.uri,${bytes}+1);}catch{truncated=true;}if(${bytes}>1){try{await native.hashBlocks(file.uri,${bytes}-1);}catch{extra=true;}}
     return {result,milliseconds:performance.now()-start,truncated,extra};}finally{file.parentDirectory.delete();}`);
   const value=Buffer.alloc(bytes,91),hash=b=>crypto.createHash('sha256').update(b).digest('hex'),blocks=[];for(let p=0;p<bytes;p+=3_000_000)blocks.push(hash(value.subarray(p,p+3_000_000)));
   if(actual.result.checksum!==hash(value)||JSON.stringify(actual.result.blocks)!==JSON.stringify(blocks)||!actual.truncated||(bytes>1&&!actual.extra))throw Error('Native hash validation failed');
   results.push({device:t.deviceName,bytes,...actual,verified:true});console.log(JSON.stringify(results.at(-1)));
  }
 }
 fs.writeFileSync('builds/native-source-hash-validation-20261023.json',JSON.stringify(results,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
