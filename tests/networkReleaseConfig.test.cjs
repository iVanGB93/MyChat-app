const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('src/services/transports/p2pTextBridge.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
test('release enables only the pinned network path, with explicit build opt-in',()=>{
 for(const flag of ['1','0',undefined]){
  const s={exports:{},__DEV__:false,process:{env:{EXPO_PUBLIC_AXONIC_NETWORK:flag,EXPO_PUBLIC_AXONIC_P2P_TEXT:'1'}}};vm.runInNewContext(code,s);
  assert.equal(s.exports.MAILBOX_ENABLED,flag==='1');assert.equal(s.exports.P2P_TEXT_ENABLED,false);
 }
 const eas=JSON.parse(fs.readFileSync('eas.json'));assert.equal(eas.build.production.env.EXPO_PUBLIC_AXONIC_NETWORK,'1');assert.equal(eas.build.production.android.buildType,'app-bundle');
});
