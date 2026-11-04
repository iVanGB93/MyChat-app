const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {GROUP_CUSTODY_LIMITS}=require('./helpers/attachment.cjs').load('groupCustodyService');
const source=fs.readFileSync('src/composition/neuronRuntime.ts','utf8');
const readBody=source.match(/store:\{read:async account=>\{(const raw=await AsyncStorage.getItem\('@axonic_group_outbox_v1:'[\s\S]*?)\},write:/)[1];
test('phone group outbox uses the shared capacity, not its former 128-row limit',async()=>{
 let raw=JSON.stringify(Array.from({length:129},()=>({}))),reads=0;
 const read=new Function('AsyncStorage','GROUP_CUSTODY_LIMITS','account',`return (async()=>{${readBody}})();`);
 const storage={getItem:async()=>{reads++;return raw;}};
 assert.equal((await read(storage,GROUP_CUSTODY_LIMITS,'owner')).length,129);
 raw=JSON.stringify(Array.from({length:GROUP_CUSTODY_LIMITS.perSender},()=>({})));
 assert.equal((await read(storage,GROUP_CUSTODY_LIMITS,'owner')).length,GROUP_CUSTODY_LIMITS.perSender);
 raw=JSON.stringify(Array.from({length:GROUP_CUSTODY_LIMITS.perSender+1},()=>({})));
 await assert.rejects(read(storage,GROUP_CUSTODY_LIMITS,'owner'),/Invalid group outbox/);
 raw='{}';await assert.rejects(read(storage,GROUP_CUSTODY_LIMITS,'owner'),/Invalid group outbox/);assert.equal(reads,4);
});
