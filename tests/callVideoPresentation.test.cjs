const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const api={};new Function('exports',ts.transpileModule(fs.readFileSync('src/services/callVideoPresentation.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(api);
test('call video presentation distinguishes stop from invalid or unsupported hints',()=>{
 assert.equal(api.readCallVideoState(api.callVideoState(true)),true);
 assert.equal(api.readCallVideoState(api.callVideoState(false)),false);
 for(const value of [null,{},'{','null','[]','{"version":2,"sharing":true}','{"version":1,"sharing":"true"}',' '.repeat(65)])assert.equal(api.readCallVideoState(value),null);
});
