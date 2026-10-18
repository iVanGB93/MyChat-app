// Explicitly restricted to the authorized separate Dev package on the test phone.
const {execFileSync,spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const {pipeline}=require('node:stream/promises');
const {run,until}=require('./test-two-phone-dev.cjs');
const adb='C:/Users/iVan/AppData/Local/Android/Sdk/platform-tools/adb.exe',serial=process.argv[2]??'R3GYC0H7PMY';
if(!['R3GYC0H7PMY','R3GL10CNS1K'].includes(serial))throw Error('Not an authorized test phone');
const command=args=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8'});
const targets=async()=>await(await fetch('http://127.0.0.1:8081/json/list')).json();
// Identical phone model names are not unique. Bind debugger preservation checks
// to the exact authorized ADB device, never whichever target appears first.
const prefixes={R3GYC0H7PMY:'737378d0ee3d6d92454bdc00c70a11f88cb4b621',R3GL10CNS1K:'c105964d4a6122be03ab7886c02d4590978b87bd'};
const expected=prefixes[serial];
if(process.argv[3]&&process.argv[3]!==expected)throw Error('Debugger target does not match phone serial');
const select=ts=>{const matches=ts.filter(t=>t.appId==='com.axonic.dev'&&t.id.split('-')[0]===expected);if(matches.length>1)throw Error('Ambiguous Dev debugger');return matches[0];};
const inspect=t=>run(t,`const s=account.status();if(s.state!=='unlocked'||s.busy)throw Error('Unlock Dev first');return {owner:s.account,keys:(await ledger().snapshot()).messages.map(m=>m.peer+':'+m.direction+':'+m.id)};`);
async function main(){
 const apk=path.resolve('android/app/build/outputs/apk/debug/app-debug.apk');
 const badging=execFileSync('C:/Users/iVan/AppData/Local/Android/Sdk/build-tools/36.0.0/aapt.exe',['dump','badging',apk],{encoding:'utf8'});
 if(!/^package: name='com\.axonic\.dev'/m.test(badging))throw Error('Refusing non-Dev APK');
 if(command(['shell','getprop','ro.product.model']).trim()!=='SM-S948U1')throw Error('Wrong phone');
 const target=select(await targets());if(!target)throw Error('Open Dev first');const before=await inspect(target);
 const officialBefore=command(['shell','dumpsys','package','com.axonic']).split('\n').filter(l=>/versionCode=|lastUpdateTime=/.test(l));
 command(['shell','am','force-stop','com.axonic.dev']);
 const backup=path.resolve('builds','phone-dev-before-wss-'+Date.now()+'.tar');
 // Stream the full private archive: larger Dev histories must not exceed a
 // one-GiB exec buffer or require an equally large allocation on the PC.
 const child=spawn(adb,['-s',serial,'exec-out','run-as','com.axonic.dev','tar','-cf','-','.'],{stdio:['ignore','pipe','pipe']});
 child.stderr.resume();
 await Promise.all([pipeline(child.stdout,fs.createWriteStream(backup,{flags:'wx'})),new Promise((resolve,reject)=>{
  child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('Dev archive command failed')));
 })]);
 const bytes=fs.statSync(backup).size;if(bytes<1024)throw Error('Backup incomplete');
 const entries=execFileSync('tar',['-tf',backup],{encoding:'utf8',maxBuffer:16*1024*1024});
 if(!entries.includes('./files/')||!entries.includes('./shared_prefs/'))throw Error('Dev archive validation failed');
 console.log(JSON.stringify({backup,bytes,archiveValidated:true,baselineMessages:before.keys.length}));
 console.log(command(['install','-r',apk]));
 command(['reverse','tcp:8081','tcp:8081']);
 command(['shell','am','start','-a','android.intent.action.VIEW','-d','exp+axonic-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081','-p','com.axonic.dev']);
 const next=(await until(async()=>select(await targets()),'Dev reconnect',120000)).value;
 const after=(await until(async()=>{try{return await inspect(next);}catch{return null;}},'Dev account unlock',120000)).value;
 if(after.owner!==before.owner||before.keys.some(k=>!after.keys.includes(k)))throw Error('Dev preservation check failed');
 const officialAfter=command(['shell','dumpsys','package','com.axonic']).split('\n').filter(l=>/versionCode=|lastUpdateTime=/.test(l));
 if(JSON.stringify(officialBefore)!==JSON.stringify(officialAfter))throw Error('Official package metadata changed');
 console.log(JSON.stringify({updated:'com.axonic.dev',sameIdentity:true,allBaselineMessagesRetained:true,officialPackageUnchanged:true}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
