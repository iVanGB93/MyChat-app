const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function fixture(){const mod={},displayed=new Map(),cancelled=[];
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/rootMessageNotification.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod,()=>({default:{getDisplayedNotifications:async()=>[...displayed.values()].map(notification=>({notification})),cancelNotification:async id=>{cancelled.push(id);displayed.delete(id);}}}));
 const add=(account,sender,group,legacy=false)=>{const id=legacy?`root-message:${account}:${sender}:old`:mod.rootMessageNotificationId(account,sender,group);displayed.set(id,{id,data:{type:'root_neuron_message',account,sender,...(group?{group}:{})}});return id;};
 return {mod,add,displayed,cancelled};
}
test('opening a direct room clears its latest and legacy notifications only',async()=>{
 const f=fixture(),direct=f.add('owner','friend'),legacy=f.add('owner','friend',undefined,true);
 f.add('owner','other');f.add('owner','friend','group');f.add('other-owner','friend');
 await f.mod.dismissRootConversationNotifications('owner',{peer:'friend'});assert.deepEqual(f.cancelled,[direct,legacy]);assert.equal(f.displayed.size,3);
});
test('opening a group clears all sender notices for that group without clearing direct rooms',async()=>{
 const f=fixture(),group=f.add('owner','friend','group'),legacy=f.add('owner','other','group',true);
 f.add('owner','friend');f.add('owner','friend','other-group');f.add('other-owner','friend','group');
 await f.mod.dismissRootConversationNotifications('owner',{group:'group'});assert.deepEqual(f.cancelled,[group,legacy]);assert.equal(f.displayed.size,3);
});
