const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const tempRoot=path.resolve(os.tmpdir());
const output=fs.mkdtempSync(path.join(tempRoot,'axonic-native-guard-'));
const tool=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name+(process.platform==='win32'?'.exe':'')):name;
try {
  cp.execFileSync(tool('javac'),['-encoding','UTF-8','-d',output,path.join(root,'scripts/native/AxonicIdentityDataGuard.java'),path.join(root,'tests/native/AxonicIdentityDataGuardTest.java')],{stdio:'inherit'});
  cp.execFileSync(tool('java'),['-cp',output,'com.oney.WebRTCModule.AxonicIdentityDataGuardTest'],{stdio:'inherit'});
} finally {
  if(path.dirname(path.resolve(output))!==tempRoot || !path.basename(output).startsWith('axonic-native-guard-'))throw Error('Unexpected test output directory');
  fs.rmSync(output,{recursive:true,force:true});
}
