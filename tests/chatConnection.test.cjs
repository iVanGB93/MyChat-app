const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const out={};new Function('exports',ts.transpileModule(fs.readFileSync('src/modules/network/chatConnection.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out);
const {chatConnection}=out,connection=(account,route='lan',state='connected',expiresAt=200)=>({account,route,state,expiresAt});
test('connection bar distinguishes the recipient from other neurons and expired sessions',()=>{
 assert.equal(chatConnection('recipient',[],100).kind,'offline');
 assert.equal(chatConnection('recipient',[connection('other','internet')],100).kind,'network');
 assert.equal(chatConnection('recipient',[connection('recipient','lan','connecting')],100).kind,'offline');
 assert.equal(chatConnection('recipient',[connection('recipient','lan','connected',99)],100).kind,'offline');
 assert.equal(chatConnection('recipient',[connection('recipient','internet')],100).label,'Direct peer · Internet');
 assert.equal(chatConnection('recipient',[connection('recipient','internet'),connection('recipient')],100).label,'Direct peer · Local Wi-Fi');
});
