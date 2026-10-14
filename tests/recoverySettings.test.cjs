const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(storage){const cache=new Map();function module(name){if(cache.has(name))return cache.get(name);const e={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>n==='@react-native-async-storage/async-storage'?{default:storage}:module(n.replace('./','')),e);cache.set(name,e);return e;}return module('recoverySettings');}
test('recovery preferences persist, reject unsafe ranges, restore defaults, and survive a failed save',async()=>{
 let saved=null,fail=false;const storage={getItem:async()=>saved,setItem:async(k,v)=>{if(fail)throw Error('disk');saved=v;}};
 const m=load(storage);await m.loadRecoverySettings();assert.deepEqual(m.recoverySettings(),{pollsPerMinute:60,custodyFramesPerMinute:512});
 await m.saveRecoverySettings({pollsPerMinute:90,custodyFramesPerMinute:1024});const reopened=load(storage);await reopened.loadRecoverySettings();assert.deepEqual(reopened.recoverySettings(),m.recoverySettings());
 for(const next of [{pollsPerMinute:0,custodyFramesPerMinute:512},{pollsPerMinute:60,custodyFramesPerMinute:999999}])await assert.rejects(m.saveRecoverySettings(next));
 fail=true;await assert.rejects(m.saveRecoverySettings({...m.defaultRecoverySettings}));assert.equal(m.recoverySettings().pollsPerMinute,90);
 fail=false;await m.saveRecoverySettings({...m.defaultRecoverySettings});assert.equal(m.recoverySettings().pollsPerMinute,60);
 saved='{broken';const invalid=load(storage);await invalid.loadRecoverySettings();assert.deepEqual(invalid.recoverySettings(),m.defaultRecoverySettings);
});
