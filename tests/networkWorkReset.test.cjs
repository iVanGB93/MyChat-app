const test=require('node:test'),assert=require('node:assert/strict');
const {load,fixture:attachmentFixture,now}=require('./helpers/attachment.cjs');
const {createNetworkWorkReset,parseNetworkReset,networkResetKeys,networkResetTables}=load('networkWorkReset');
const {createRootChatLedger,pendingRootChat}=load('rootChatLedger'),{rootMessageStatus}=load('rootMessageStatus');
const owner='axonic:1:'+'a'.repeat(64),peer='axonic:1:'+'b'.repeat(64),id='1'.repeat(64);
function resetFixture(){let raw=null,purges=0,fail=false,vault=owner;const d={read:async()=>raw,write:async v=>raw=v,clear:async()=>raw=null,vaultAccount:async()=>vault,purge:async()=>{purges++;if(fail)throw Error('disk');}};return {d,make:()=>createNetworkWorkReset(d),raw:()=>raw,purges:()=>purges,fail:v=>fail=v,vault:v=>vault=v};}
test('network reset persists intent but cannot purge a running process; cold concurrent startup purges once',async()=>{
 const f=resetFixture(),live=f.make();await live.beforeStartup();await live.request(owner,100);await assert.rejects(live.assertAvailable(),/reopen/);await assert.rejects(live.beforeStartup(),/reopen/);assert.equal(f.purges(),0);
 const cold=f.make();await Promise.all([cold.beforeStartup(),cold.beforeStartup()]);assert.equal(f.purges(),1);assert.equal(f.raw(),null);await cold.assertAvailable();
});
test('failed reset stays gated, retries on startup, and never purges a different account',async()=>{
 const f=resetFixture();await f.make().request(owner,100);f.vault(peer);await assert.rejects(f.make().beforeStartup(),/does not match/);assert.equal(f.purges(),0);f.vault(owner);f.fail(true);const cold=f.make();await assert.rejects(cold.beforeStartup(),/disk/);await assert.rejects(cold.assertAvailable());f.fail(false);await cold.beforeStartup();assert.equal(f.raw(),null);
});
test('reset rejects malformed journals and has a narrow account-scoped allowlist',()=>{
 for(const raw of ['null','{}',JSON.stringify({version:1,account:'../../escape',at:100}),JSON.stringify({version:1,account:owner,at:-1}),JSON.stringify({version:1,account:owner,at:100,all:true})])assert.throws(()=>parseNetworkReset(raw));
 assert(networkResetKeys(owner).every(k=>k.endsWith(owner)));assert(!networkResetTables.some(([f])=>/identity|chat/.test(f)));assert(!networkResetKeys(owner).some(k=>/root_chat|username|profile|known_neurons/.test(k)));
});
test('reset cancels blocked and unblocked pending sends, retains history and receipt evidence, and allows new sends',async()=>{
 let raw=null;const ledger=createRootChatLedger({owner,read:async()=>raw,write:async v=>raw=v,current:()=>true,now:()=>100});
 await ledger.enqueue(peer,id,'keep my text');await ledger.networkStored(peer,id,500);await ledger.configure(peer,{blocked:true});
 await ledger.cancelNetworkWork(200);let s=await ledger.snapshot();assert.equal(s.messages[0].text,'keep my text');assert.equal(s.messages[0].status,'pending');assert.equal(s.messages[0].storedAt,100);assert.equal(rootMessageStatus(s.messages[0],201),'cancelled');
 await ledger.configure(peer,{blocked:false});assert.equal(pendingRootChat(await ledger.snapshot(),owner).length,0);
 await ledger.cancelNetworkWork(200);assert.equal((await ledger.snapshot()).cancelledNetworkWork.length,1);
 await ledger.enqueue(peer,'2'.repeat(64),'new work');assert.equal(pendingRootChat(await ledger.snapshot(),owner).length,1);
 await ledger.delivered(peer,id);s=await ledger.snapshot();assert.equal(rootMessageStatus(s.messages[0]),'delivered');assert.equal(s.messages[0].networkCancelledAt,200);
});
test('corrupt chat storage prevents reset, with no replacement write',async()=>{
 let writes=0;const ledger=createRootChatLedger({owner,read:async()=>'{broken',write:async()=>writes++,current:()=>true,now:()=>100});await assert.rejects(ledger.cancelNetworkWork(200));assert.equal(writes,0);
});
test('pending media cancellation survives reload and cannot authorize transfers',async()=>{
 const f=attachmentFixture(),a=f.ids[0].record.account,b=f.ids[1].record.account,descriptor={manifest:f.manifest,key:Buffer.from(f.key).toString('hex'),checksum:require('node:crypto').createHash('sha256').update(f.plain).digest('hex'),name:'test.bin',mime:'application/octet-stream'};
 let raw=null;const options={owner:a,read:async()=>raw,write:async v=>raw=v,current:()=>true,now:()=>now,verifyAttachment:async()=>true};
 const ledger=createRootChatLedger(options);await ledger.enqueueAttachment(descriptor);await ledger.cancelNetworkWork(now+1);
 const s=await createRootChatLedger(options).snapshot();assert.equal(s.messages[0].peer,b);assert.equal(rootMessageStatus(s.messages[0]),'cancelled');assert.equal(pendingRootChat(s,a).length,0);
 const {attachmentDigest}=load('attachmentProtocol');assert.equal(load('attachmentPolicy').indexAttachmentPolicy(s,a)({owner:a,digest:attachmentDigest(f.manifest)}),false);
 let incoming=null;const receiver=createRootChatLedger({...options,owner:b,read:async()=>incoming,write:async v=>incoming=v});
 assert(await receiver.receive(a,f.manifest.id,load('rootChatLedger').encodeRootAttachment(b,f.manifest.id,descriptor)));
 await receiver.cancelNetworkWork(now+2);const received=await receiver.snapshot();assert.equal(received.messages.length,1);assert.equal(rootMessageStatus(received.messages[0]),'cancelled');assert.equal(load('attachmentPolicy').indexAttachmentPolicy(received,b)({owner:b,digest:attachmentDigest(f.manifest)}),false);
});
test('group bubble retains cancellation regardless of recipient order; completed recipients stay delivered',()=>{
 const {rootGroupMessages}=load('rootGroups'),base={id,peer,direction:'outgoing',text:'group',at:1,status:'pending',group:{id:'3'.repeat(64),revision:1,messageId:'4'.repeat(64)}};
 const delivered={...base,status:'delivered'},cancelled={...base,id:'2'.repeat(64),networkCancelledAt:100};
 for(const messages of [[delivered,cancelled],[cancelled,delivered]])assert.equal(rootMessageStatus(rootGroupMessages({messages},base.group.id)[0]),'cancelled');
 assert.equal(rootMessageStatus(delivered),'delivered');
});
test('pending-journal clear failure can retry without opening networking',async()=>{
 const f=resetFixture();await f.make().request(owner,100);let fail=true;const clear=f.d.clear;f.d.clear=async()=>{if(fail)throw Error('journal');await clear();};const cold=f.make();await assert.rejects(cold.beforeStartup(),/journal/);await assert.rejects(cold.assertAvailable());fail=false;await cold.beforeStartup();assert.equal(f.raw(),null);
});
