const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const mod={};new Function('exports',ts.transpileModule(fs.readFileSync('src/utils/message-day.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod);
const at=(y,m,d,h=12)=>new Date(y,m-1,d,h).getTime();
test('date separators follow local midnight and calendar boundaries',()=>{
 assert.equal(mod.startsMessageDay(at(2026,10,27,0),at(2026,10,26,23)),true);
 assert.equal(mod.startsMessageDay(at(2026,10,27,23),at(2026,10,27,0)),false);
 assert.equal(mod.startsMessageDay(at(2027,1,1),at(2026,12,31)),true);
 assert.equal(mod.startsMessageDay(at(2026,11,1),at(2026,10,1)),true);
 assert.equal(mod.startsMessageDay(at(2026,10,27)),true);
 assert.equal(mod.startsMessageDay(NaN),false);
});
test('loading older items moves a date marker instead of duplicating it',()=>{
 const recent=[at(2026,10,27,14),at(2026,10,27,12)];
 const markers=rows=>rows.filter((n,i)=>mod.startsMessageDay(n,rows[i+1]));
 assert.deepEqual(markers(recent),[recent[1]]);
 const older=[...recent,at(2026,10,27,10),at(2026,10,26,23)];
 assert.deepEqual(markers(older),older.slice(2));
});
