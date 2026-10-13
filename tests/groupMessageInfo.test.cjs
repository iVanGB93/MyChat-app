const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function load(path,deps={}){const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>deps[n]);return out;}
const status=load('src/services/identity/rootMessageStatus.ts'),presentation=load('src/modules/messaging/messageInfoState.ts',{'../../services/identity/rootMessageStatus':status}),mod=load('src/modules/messaging/groupMessageInfo.ts',{'../../services/identity/rootMessageStatus':status,'./messageInfoState':presentation});
const m=(peer,patch={})=>({id:peer,peer,direction:'outgoing',group:{id:'group',messageId:'logical'},text:'Hello',at:100,status:'pending',...patch});
test('group info preserves each original recipient and distinguishes stored, delivered and read',()=>{
 const state={messages:[m('a',{status:'delivered',read:true}),m('b',{status:'delivered'}),m('former-member',{networkStoredUntil:200}),m('d'),m('unrelated',{group:{id:'other',messageId:'logical'}})]};
 const info=mod.groupMessageInfo(state,'owner','group',{id:'logical',author:'owner'},150);
 assert.deepEqual(info.recipients.map(r=>r.status),['read','delivered','stored','pending']);assert.equal(info.read,1);assert.equal(info.delivered,2);assert.equal(info.recipients.length,4);
 assert.equal(info.pending,1);assert.equal(info.stored,1);assert.equal(info.pending+info.stored+info.delivered,4);
 const expired=mod.groupMessageInfo(state,'owner','group',{id:'logical',author:'owner'},200);assert.equal(expired.stored,0);assert.equal(expired.pending,2);
});
test('incoming and missing messages cannot invent per-recipient information',()=>{
 const state={messages:[m('sender',{direction:'incoming',status:'delivered'})]};
 assert.equal(mod.groupMessageInfo(state,'owner','group',{id:'logical',author:'owner'}),null);
 assert.deepEqual(mod.groupMessageInfo(state,'owner','group',{id:'logical',author:'sender'}).recipients,[]);
});
