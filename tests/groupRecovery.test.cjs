const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./helpers/attachment.cjs');
const {createGroupRecovery}=load('groupRecovery');
test('reconnect sync is bounded, retries failures and resets for a new owner',async()=>{
 let owner='owner',peers=['peer'],now=0,fail=false;const calls=[];
 const r=createGroupRecovery({owner:()=>owner,peers:()=>peers,now:()=>now,random:async()=>'nonce',recover:async(peer)=>{if(fail)throw Error('locked');calls.push(peer);}});
 await r.tick();await r.tick();assert.deepEqual(calls,['peer']);
 peers=[];await r.tick();peers=['peer'];await r.tick();assert.equal(calls.length,1);
 now=60000;fail=true;await assert.rejects(r.tick());fail=false;await r.tick();assert.equal(calls.length,2);
 owner='restored';await r.tick();assert.equal(calls.length,3);
});
test('locking during random generation does not queue metadata under another account',async()=>{
 let owner='one',queued=0;const r=createGroupRecovery({owner:()=>owner,peers:()=>['peer'],now:()=>0,random:async()=>{owner=null;return 'nonce';},recover:async()=>{queued++;}});
 await r.tick();assert.equal(queued,0);
});
test('explicit reconnect survives a disconnect and reconnect between coordinator runs',async()=>{
 let now=0,calls=0;const r=createGroupRecovery({owner:()=> 'owner',peers:()=>['peer'],now:()=>now,random:async()=> 'nonce',recover:async()=>{calls++;}});
 await r.tick();assert.equal(r.nextDeadline(),Infinity);r.connected('peer');assert.equal(r.nextDeadline(),60000);now=60000;await r.tick();assert.equal(calls,2);assert.equal(r.nextDeadline(),Infinity);
});
