const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const api={};new Function('exports',ts.transpileModule(fs.readFileSync('src/modules/ui/attachmentTimeline.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(api);
const merge=api.attachmentTimeline,key=s=>'message:outgoing:'+s.id;
test('preparation keeps final key and chronological position through publication',()=>{
 const selection={id:'photo',createdAt:20},older={key:'old',at:10},newer={key:'new',at:30};
 const before=merge([newer,older],[selection],key);
 const actual={key:key(selection),at:20,message:{id:'photo'}};
 const after=merge([newer,actual,older],[selection],key);
 assert.deepEqual(before.map(r=>r.key),after.map(r=>r.key));assert.equal(after[1],actual);assert.equal(after.length,3);
});
test('group recipient selections occupy one logical message row',()=>{
 const selections=[{id:'a',createdAt:20,group:{messageId:'g'}},{id:'b',createdAt:20,group:{messageId:'g'}}];
 const rows=merge([],selections,s=>'own:'+s.group.messageId);assert.equal(rows.length,1);assert.equal(rows[0].key,'own:g');
});
test('calls and messages preserve chronological order around pending media',()=>{
 const rows=merge([{key:'call',at:30},{key:'message',at:10}],[{id:'photo',createdAt:20}],key);
 assert.deepEqual(rows.map(r=>r.at),[30,20,10]);assert.equal(rows[1].preparation.id,'photo');
});
