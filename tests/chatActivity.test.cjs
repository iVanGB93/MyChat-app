const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const out={};new Function('exports',ts.transpileModule(fs.readFileSync('src/services/identity/chatActivity.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out);
function fixture(){let now=100000,owner='self',allowed=true;const sent=[];const activity=out.createChatActivity({owner:()=>owner,now:()=>now,allowed:async()=>allowed,send:async(...a)=>{sent.push(a);return true;}});return {activity,sent,advance:n=>now+=n,block:()=>allowed=false,lock:()=>owner=null};}
test('ephemeral typing is scoped to recipient, expires, and never consumes normal chat',async()=>{
 const f=fixture();assert.equal(await f.activity.receive('peer','["ordinary-message"]'),null);
 assert.equal(await f.activity.receive('peer','["axonic-chat-activity-v1","self",true,107000]'),true);assert.equal(f.activity.typing('peer'),true);
 f.advance(7001);assert.equal(f.activity.typing('peer'),false);
 assert.equal(await f.activity.receive('peer','["axonic-chat-activity-v1","wrong",true,114000]'),false);
});
test('typing is rate limited, stop is immediate, and block/lock prevents transmission',async()=>{
 const f=fixture();await f.activity.notify('peer',true);await f.activity.notify('peer',true);assert.equal(f.sent.length,1);
 await f.activity.notify('peer',false);assert.equal(f.sent.length,2);
 f.block();f.advance(4000);await f.activity.notify('peer',true);assert.equal(f.sent.length,2);
 f.activity.clear();assert.equal(f.activity.typing('peer'),false);f.lock();await f.activity.notify('peer',false);assert.equal(f.sent.length,2);
});
test('future, stale, malformed and blocked activity frames are rejected',async()=>{
 const f=fixture();for(const raw of ['["axonic-chat-activity-v1","self",true,99999]','["axonic-chat-activity-v1","self",true,200000]','["axonic-chat-activity-v1","self","yes",107000]'])assert.equal(await f.activity.receive('peer',raw),false);
 f.block();assert.equal(await f.activity.receive('peer','["axonic-chat-activity-v1","self",true,107000]'),false);
});

test('concurrent typing notifications coalesce after asynchronous permission checks',async()=>{
 const f=fixture();await Promise.all([f.activity.notify('peer',true),f.activity.notify('peer',true)]);assert.equal(f.sent.length,1);
});
test('group activity never leaks into direct chats or another group',async()=>{
 const f=fixture(),group='a'.repeat(64);await f.activity.receive('peer',JSON.stringify(['axonic-chat-activity-v1','self',true,107000,group]));
 assert.equal(f.activity.typing('peer',group),true);assert.equal(f.activity.typing('peer'),false);assert.equal(f.activity.typing('peer','b'.repeat(64)),false);
});
