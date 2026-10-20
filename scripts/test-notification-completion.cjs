const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {before,after}=require('./patch-notifee-block-completion.cjs');
const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(root,'builds/notifee-completion-'));
const tool=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name+(process.platform==='win32'?'.exe':'')):name;
const harness=fs.readFileSync(path.join(root,'tests/native/NotifeeCompletionHarness.java'),'utf8');
for(const [label,body] of [['baseline',before],['fixed',after]]){
 const dir=path.join(out,label);fs.mkdirSync(dir);
 const source=path.join(dir,'NotifeeCompletionHarness.java');fs.writeFileSync(source,harness.replace('/* PATCH_BODY */',body));
 cp.execFileSync(tool('javac'),['-encoding','UTF-8','-d',dir,source,...['Handler','Looper'].map(n=>path.join(root,'tests/native/notifee-stubs/android/os/'+n+'.java'))],{stdio:'inherit'});
 cp.execFileSync(tool('java'),['-cp',dir,'NotifeeCompletionHarness',label],{stdio:'inherit'});
}
console.log('Retained test artifacts: '+out);
