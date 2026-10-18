// Explicitly restricted to the authorized separate Dev package on the test phone.
const {execFileSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const {run,until}=require('./test-two-phone-dev.cjs');
const adb='C:/Users/iVan/AppData/Local/Android/Sdk/platform-tools/adb.exe',serial=process.argv[2]??'R3GYC0H7PMY';
if(!['R3GYC0H7PMY','R3GL10CNS1K'].includes(serial))throw Error('Not an authorized test phone');
const command=args=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8'});
const targets=async()=>await(await fetch('http://127.0.0.1:8081/json/list')).json();
const select=ts=>ts.find(t=>t.appId==='com.axonic.dev'&&t.deviceName.startsWith('SM-S948U1')&&(!process.argv[3]||t.id.split('-')[0]===process.argv[3]));
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
 const data=execFileSync(adb,['-s',serial,'exec-out','run-as','com.axonic.dev','tar','-cf','-','.'],{maxBuffer:1024*1024*1024});
 if(data.length<1024)throw Error('Backup incomplete');fs.writeFileSync(backup,data,{flag:'wx'});
 console.log(JSON.stringify({backup,bytes:data.length,baselineMessages:before.keys.length}));
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
