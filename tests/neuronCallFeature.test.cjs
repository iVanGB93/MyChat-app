const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function enabled(dev,env){const out={};new Function('exports','__DEV__','process',ts.transpileModule(fs.readFileSync('src/services/identity/neuronCallFeature.ts','utf8'),{compilerOptions:{module:1}}).outputText)(out,dev,{env});return out.neuronCallsEnabled();}
test('neuron calling uses the same explicit switch in development and production',()=>{
 for(const dev of [true,false]){
  assert.equal(enabled(dev,{}),false);
  assert.equal(enabled(dev,{EXPO_PUBLIC_AXONIC_CALL_CONTROL:'0'}),false);
  assert.equal(enabled(dev,{EXPO_PUBLIC_AXONIC_CALL_CONTROL:'1'}),true);
 }
 const profiles=JSON.parse(fs.readFileSync('eas.json','utf8')).build;
 assert.equal(profiles.production.env.EXPO_PUBLIC_AXONIC_CALL_CONTROL,'1');
 assert.equal(profiles.production.env.EXPO_PUBLIC_AXONIC_NETWORK,'1');
 assert.equal(profiles.production.env.EXPO_PUBLIC_AXONIC_CHAT_IDENTITY,'1');
 assert.equal(profiles.production.android.buildType,'app-bundle');
 assert.equal(profiles['neuron-testing'],undefined);
});
