const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function load(storage){const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/allowedAxons.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(()=>({default:storage}),out);return out;}
test('phone axon preference defaults to five, persists only integers 3–10 and reloads',async()=>{
 let saved=null,fail=false;const storage={getItem:async()=>saved,setItem:async(_key,value)=>{if(fail)throw Error('disk');saved=value;}};
 const m=load(storage);assert.equal(m.allowedAxons(),5);await m.loadAllowedAxons();let changes=0;m.subscribeAllowedAxons(()=>changes++);
 for(const v of [2,11,3.5,'5',null])await assert.rejects(m.setAllowedAxons(v));
 await m.setAllowedAxons(10);assert.equal(m.allowedAxons(),10);assert.equal(changes,1);
 const reopened=load(storage);await reopened.loadAllowedAxons();assert.equal(reopened.allowedAxons(),10);
 fail=true;await assert.rejects(m.setAllowedAxons(3));assert.equal(m.allowedAxons(),10);
 saved='20';const invalid=load(storage);await invalid.loadAllowedAxons();assert.equal(invalid.allowedAxons(),5);
});
