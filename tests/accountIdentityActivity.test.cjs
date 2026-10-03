const test=require('node:test'),assert=require('node:assert/strict');
const {accountIdentityMayRun}=require('../src/services/identity/accountIdentityActivity.ts');
test('background identity lease requires this owner connected with a running call service',()=>{
 const s={user:{id:14},appLifecycle:'background',foregroundServiceRunning:true,activeCall:{ownerId:14,transport:'neuron',state:'connected'}};
 assert.equal(accountIdentityMayRun(s),true);
 for(const change of [{user:null},{user:{id:18}},{foregroundServiceRunning:false},{activeCall:null},
   {activeCall:{...s.activeCall,state:'ringing'}},{activeCall:{...s.activeCall,state:'connecting'}},
   {activeCall:{...s.activeCall,transport:undefined}},{activeCall:{...s.activeCall,ownerId:undefined}}])
   assert.equal(accountIdentityMayRun({...s,...change}),false);
 assert.equal(accountIdentityMayRun({...s,activeCall:null,appLifecycle:'active'}),true);
});
