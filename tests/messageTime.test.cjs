const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const mod={};new Function('exports',ts.transpileModule(fs.readFileSync('src/utils/message-time.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod);
test('reused message formatter matches existing local-time labels, including DST and invalid dates',()=>{
 for(const locale of [[], 'en-US','es-US','en-GB'])for(const timeZone of [undefined,'UTC','America/New_York']){
  const format=mod.createMessageTimeFormatter(locale,timeZone),options={hour:'2-digit',minute:'2-digit',...(timeZone?{timeZone}:{})};
  for(const at of [0,1700000000000,Date.parse('2026-03-08T06:59:00Z'),Date.parse('2026-03-08T07:01:00Z'),Date.parse('2026-11-01T06:01:00Z'),NaN,Infinity,9e15])assert.equal(format(at),new Date(at).toLocaleTimeString(locale,options));
 }
});
