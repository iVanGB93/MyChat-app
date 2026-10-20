const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {load,fixture,now}=require('./helpers/attachment.cjs'),chat=load('rootChatLedger'),groups=load('rootGroups'),protocol=load('attachmentProtocol');
const key=()=>crypto.randomBytes(32).toString('hex');
const view=load('rootChatActions').rootChatView;

test('completed group controls do not consume pending capacity and remain intact after update/reopen',async()=>{
 const f=setup(),g=await f.group(),s=JSON.parse(f.raws[0]),sample=s.groupPackets[0];
 s.groupPackets=Array.from({length:2000},(_,i)=>({...sample,id:i.toString(16).padStart(64,'0'),status:'delivered'}));
 f.raws[0]=JSON.stringify(s);
 await f.apis[0].updateGroup(g,key(),'Updated family',f.accounts.slice(1));
 const after=await f.apis[0].snapshot();
 assert.deepEqual(after.groupPackets.slice(0,2000),s.groupPackets);
 assert.equal(after.groups[0].name,'Updated family');
 assert.equal(after.groupPackets.filter(p=>p.status==='pending').length,2);
 const reopened=chat.createRootChatLedger({owner:f.accounts[0],current:()=>true,now:()=>now,read:async()=>f.raws[0],write:async raw=>{f.raws[0]=raw;}});
 assert.deepEqual(await reopened.snapshot(),after);
});
test('full pending group queue rejects atomically with precise reason, not membership-size error',async()=>{
 const f=setup(),g=await f.group(),s=JSON.parse(f.raws[0]),sample=s.groupPackets[0];
 s.groupPackets=Array.from({length:groups.ROOT_GROUP_MAX_PENDING_PACKETS},(_,i)=>({...sample,id:i.toString(16).padStart(64,'0'),status:'pending'}));
 f.raws[0]=JSON.stringify(s);const before=f.raws[0];
 await assert.rejects(f.apis[0].updateGroup(g,key(),'Updated family',f.accounts.slice(1)),/pending-delivery queue is full/);
 assert.equal(f.raws[0],before);
});
test('reconnect recovery reuses identical pending metadata, but resends after delivery',async()=>{
 const f=setup(),g=await f.group();
 await f.apis[0].recoverGroupsForPeer(f.accounts[1],key());
 const first=(await f.apis[0].snapshot()).groupPackets;
 for(let i=0;i<10;i++)await f.apis[0].recoverGroupsForPeer(f.accounts[1],key());
 assert.deepEqual((await f.apis[0].snapshot()).groupPackets,first);
 await f.deliver(0,1);
 await f.apis[0].recoverGroupsForPeer(f.accounts[1],key());
 assert.equal((await f.apis[0].snapshot()).groupPackets.length,first.length+1);
 assert.equal((await f.apis[0].snapshot()).groups[0].id,g);
});
test('incoming group control history crosses old 2000 ceiling without losing replay protection',async()=>{
 const f=setup(),g=await f.group(),s=JSON.parse(f.raws[1]),sample=s.groupSeen[0];
 s.groupSeen=Array.from({length:2000},(_,i)=>({...sample,id:i.toString(16).padStart(64,'0')}));
 f.raws[1]=JSON.stringify(s);
 await f.apis[0].updateGroup(g,key(),'New family',f.accounts.slice(1));
 const packet=chat.pendingRootChat(await f.apis[0].snapshot(),f.accounts[0]).find(p=>p.peer===f.accounts[1]);
 assert(await f.apis[1].receive(f.accounts[0],packet.id,packet.raw));
 assert(await f.apis[1].receive(f.accounts[0],packet.id,packet.raw));
 const after=await f.apis[1].snapshot();
 assert.deepEqual(after.groupSeen.slice(0,2000),s.groupSeen);
 assert.equal(after.groupSeen.length,2001);
 const changed=JSON.parse(packet.raw);changed[3].name='Forged';
 assert.equal(await f.apis[1].receive(f.accounts[0],packet.id,JSON.stringify(changed)),false);
});
test('identical group operation retries at capacity add nothing; ID conflicts remain rejected',()=>{
 const f=setup(),owner=f.accounts[0],peer=f.accounts[1],g=key(),id=key();
 const s={version:1,messages:[],contacts:[]};
 groups.changeRootGroup(s,owner,g,id,'Family',[peer]);
 const packet=s.groupPackets[0];
 s.groupPackets.push(...Array.from({length:groups.ROOT_GROUP_MAX_PENDING_PACKETS-1},(_,i)=>({...packet,id:i.toString(16).padStart(64,'0')})));
 const before=JSON.stringify(s);
 groups.changeRootGroup(s,owner,g,id,'Family',[peer]);
 assert.equal(JSON.stringify(s),before);
 assert.throws(()=>groups.changeRootGroup(s,owner,g,id,'Other',[peer]),/ID conflict/);
 assert.equal(JSON.stringify(s),before);
});

function signedSetup(){
 const seeds=[0,1,2].map(()=>crypto.randomBytes(32)),pub=require('@noble/curves/ed25519.js').ed25519;
 const accounts=seeds.map(s=>load('identityProtocol').accountId(Buffer.from(pub.getPublicKey(s)).toString('hex'))),raws=[null,null,null];
 const apis=accounts.map((owner,i)=>chat.createRootChatLedger({owner,current:()=>true,now:()=>now,read:async()=>raws[i],write:async raw=>{raws[i]=raw;},signGroup:g=>groups.signRootGroupBackup(g,seeds[i])}));
 return {accounts,raws,apis,seeds,async deliver(i,j){for(const p of chat.pendingRootChat(await apis[i].snapshot(),accounts[i]).filter(p=>p.peer===accounts[j])){assert(await apis[j].receive(accounts[i],p.id,p.raw));await apis[i].delivered(p.peer,p.id);}}};
}
test('signed member backup restores the creator automatically without private keys or history',async()=>{
 const f=signedSetup(),g=key();await f.apis[0].createGroup(g,key(),'Signed family',f.accounts.slice(1));await f.deliver(0,1);
 assert(groups.validRootGroupBackup((await f.apis[1].snapshot()).groups[0].backup));
 f.raws[0]=null;await f.apis[1].recoverGroupsForPeer(f.accounts[0],key());await f.deliver(1,0);
 const recovered=await f.apis[0].snapshot();assert.equal(recovered.groups[0].admin,f.accounts[0]);assert.equal(recovered.groups[0].accepted,true);assert.equal(recovered.messages.length,0);
 await f.apis[0].updateGroup(g,key(),'Creator still controls membership',[f.accounts[1]]);await f.deliver(0,1);
 assert.equal((await f.apis[1].snapshot()).groups[0].revision,2);
});
test('unsigned creator recovery remains untrusted until explicit local confirmation',async()=>{
 const f=signedSetup(),g=key(),group={id:g,admin:f.accounts[0],name:'Old family',revision:1,members:f.accounts};
 const id=key(),offer=JSON.stringify(['axonic-group-recovery-offer-v1',f.accounts[0],id,group]);
 assert(await f.apis[0].receive(f.accounts[1],id,offer));let s=await f.apis[0].snapshot();
 assert.equal(s.groups[0].recoveryPending,true);assert.equal(s.groups[0].backup,undefined);assert.equal(s.groups[0].accepted,false);
 await f.apis[0].recoverGroupsForPeer(f.accounts[1],key());assert.equal(chat.pendingRootChat(await f.apis[0].snapshot(),f.accounts[0]).length,0);
 const requestId=key();assert.equal(await f.apis[0].receive(f.accounts[1],requestId,JSON.stringify(['axonic-group-recover-v1',f.accounts[0],requestId,{group:g,member:f.accounts[2]}])),false);
 assert.equal(groups.rootGroupAllowed(s,f.accounts[0],f.accounts[1],{id:g,revision:1,messageId:key()}),false);
 await assert.rejects(f.apis[0].enqueueGroup(g,key(),'must not send'));await assert.rejects(f.apis[0].updateGroup(g,key(),'changed',f.accounts));
 await f.apis[0].configureGroup(g,{accepted:true});s=await f.apis[0].snapshot();assert.equal(s.groups[0].recoveryPending,undefined);assert(groups.validRootGroupBackup(s.groups[0].backup));
});
test('backup signature rejects tampered members, name, revision, creator and wrong root',async()=>{
 const f=signedSetup(),g={id:key(),admin:f.accounts[0],name:'Family',revision:1,members:f.accounts};
 const backup=groups.signRootGroupBackup(g,f.seeds[0]);assert(groups.validRootGroupBackup(backup));
 for(const patch of [{name:'Other'},{members:[f.accounts[0],f.accounts[1]]},{revision:2},{admin:f.accounts[1]}])assert.equal(groups.validRootGroupBackup({...backup,group:{...g,...patch}}),false);
 assert.equal(groups.validRootGroupBackup({...backup,root:'1'.repeat(64)}),false);
 await assert.rejects(async()=>groups.signRootGroupBackup(g,f.seeds[1]));
});
test('older signed snapshots cannot roll back known membership or unblock a group',async()=>{
 const f=signedSetup(),g=key();await f.apis[0].createGroup(g,key(),'Family',f.accounts.slice(1));await f.deliver(0,1);
 const old=(await f.apis[1].snapshot()).groups[0].backup;
 await f.apis[0].updateGroup(g,key(),'New name',f.accounts.slice(1));await f.deliver(0,1);await f.apis[1].configureGroup(g,{blocked:true,muted:true});
 const id=key();assert(await f.apis[1].receive(f.accounts[2],id,JSON.stringify(['axonic-group-backup-v1',f.accounts[1],id,old])));
 const recovered=(await f.apis[1].snapshot()).groups[0];assert.equal(recovered.revision,2);assert.equal(recovered.name,'New name');assert.equal(recovered.blocked,true);assert.equal(recovered.muted,true);
});

test('recovered member receives current creator metadata through another member, then queued text',async()=>{
 const f=setup(),g=await f.group();
 await f.apis[0].updateGroup(g,key(),'Current family',f.accounts.slice(1));await f.deliver(0,1);await f.deliver(0,2);
 await f.apis[0].enqueueGroup(g,key(),'waiting for metadata');
 const message=chat.pendingRootChat(await f.apis[0].snapshot(),f.accounts[0]).find(p=>p.peer===f.accounts[1]);
 f.raws[1]=null;assert.equal(await f.apis[1].receive(f.accounts[0],message.id,message.raw),false);
 await f.apis[2].recoverGroupsForPeer(f.accounts[1],key());await f.deliver(2,0);
 const response=chat.pendingRootChat(await f.apis[0].snapshot(),f.accounts[0]).find(p=>p.peer===f.accounts[1]&&JSON.parse(p.raw)[0]==='axonic-group-members-v1');
 assert(response);assert(await f.apis[1].receive(f.accounts[0],response.id,response.raw));
 let restored=await f.apis[1].snapshot();assert.equal(restored.groups[0].name,'Current family');assert.equal(restored.groups[0].revision,2);assert.equal(restored.groups[0].accepted,false);assert.equal(restored.messages.length,0);
 assert(await f.apis[1].receive(f.accounts[0],message.id,message.raw));assert.equal((await f.apis[1].snapshot()).messages.length,1);
});
test('creator reconnect repairs membership without pending text and preserves local preferences',async()=>{
 const f=setup(),g=await f.group();f.raws[1]=null;
 await f.apis[0].recoverGroupsForPeer(f.accounts[1],key());await f.deliver(0,1);
 await f.apis[1].configureGroup(g,{accepted:true,blocked:true,muted:true});
 await f.apis[0].recoverGroupsForPeer(f.accounts[1],key());await f.deliver(0,1);
 const s=await f.apis[1].snapshot();assert.deepEqual([s.groups[0].accepted,s.groups[0].blocked,s.groups[0].muted],[true,true,true]);assert.equal(s.messages.length,0);assert.equal(s.contacts.length,0);
});
test('group recovery rejects outsiders, removed targets and forged membership',async()=>{
 const f=setup(),g=await f.group(),outsider='axonic:1:'+'f'.repeat(64),id=key();
 const request=member=>JSON.stringify(['axonic-group-recover-v1',f.accounts[0],id,{group:g,member}]);
 assert.equal(await f.apis[0].receive(outsider,id,request(f.accounts[1])),false);
 assert.equal(await f.apis[0].receive(f.accounts[2],id,request(outsider)),false);
 await f.apis[0].updateGroup(g,key(),'Family',[f.accounts[2]]);await f.deliver(0,2);
 assert.equal(await f.apis[0].receive(f.accounts[2],id,request(f.accounts[1])),false);
 await f.apis[2].recoverGroupsForPeer(f.accounts[1],key());assert.equal(chat.pendingRootChat(await f.apis[2].snapshot(),f.accounts[2]).length,0);
});
test('group recovery requests are durable and identical retries do not multiply responses',async()=>{
 const f=setup();await f.group();await f.apis[2].recoverGroupsForPeer(f.accounts[1],key());
 const p=chat.pendingRootChat(await f.apis[2].snapshot(),f.accounts[2])[0];
 assert(await f.apis[0].receive(f.accounts[2],p.id,p.raw));const count=(await f.apis[0].snapshot()).groupPackets.length;
 assert(await f.apis[0].receive(f.accounts[2],p.id,p.raw));assert.equal((await f.apis[0].snapshot()).groupPackets.length,count);
 const changed=JSON.parse(p.raw);changed[3].member=f.accounts[2];assert.equal(await f.apis[0].receive(f.accounts[2],p.id,JSON.stringify(changed)),false);
});

test('local group chat deletion keeps membership and direct history; a new group message reopens it',async()=>{
 const f=setup(),g=await f.group();await f.apis[0].enqueueGroup(g,key(),'old group text');await f.deliver(0,1);
 await f.apis[1].enqueue(f.accounts[0],key(),'private text');
 await f.apis[1].deleteChats(['group:'+g]);let s=await f.apis[1].snapshot();
 assert.equal(s.messages.length,1);assert.equal(s.messages[0].text,'private text');
 assert(s.groups.find(v=>v.id===g).accepted);assert.deepEqual(s.hiddenChats,['group:'+g]);
 await f.apis[0].enqueueGroup(g,key(),'new group text');await f.deliver(0,1);
 s=await f.apis[1].snapshot();assert.deepEqual(s.hiddenChats,[]);
 assert.equal(s.messages.filter(m=>m.group?.id===g).length,1);
});

test('group replies bind logical message and author across different recipient copies',async()=>{const f=setup(),g=await f.group(),id=key();await f.apis[0].enqueueGroup(g,id,'original');await f.deliver(0,1);await f.deliver(0,2);const reply={id,author:f.accounts[0]};await f.apis[1].enqueueGroup(g,key(),'reply from member',reply);await f.deliver(1,0);await f.deliver(1,2);for(const a of f.apis){const s=await a.snapshot();assert.deepEqual(s.messages.find(m=>m.text==='reply from member').reply,reply);}await assert.rejects(f.apis[2].enqueueGroup(g,key(),'invalid',{id:key(),author:f.accounts[0]}));assert.equal((await f.apis[1].snapshot()).contacts.length,0);});

test('group author edits fan out immutably with separate receipts and permanent deletion',async()=>{const f=setup(),g=await f.group(),id=key(),target={id,author:f.accounts[0]};await f.apis[0].enqueueGroup(g,id,'original');await f.deliver(0,1);await f.deliver(0,2);const edit=key();await f.apis[0].actGroup(g,edit,target,'edit','updated');const packets=chat.pendingRootChat(await f.apis[0].snapshot(),f.accounts[0]);assert.equal(packets.length,2);assert.notEqual(packets[0].id,packets[1].id);await f.apis[0].actGroup(g,edit,target,'edit','updated');assert.equal((await f.apis[0].snapshot()).groupActions.length,2);await f.deliver(0,1);assert.equal((await f.apis[0].snapshot()).groupActions.filter(a=>a.status==='delivered').length,1);await f.deliver(0,2);for(let i=0;i<3;i++){const s=await f.apis[i].snapshot();assert.equal(s.messages[0].text,'original');assert.equal(view(f.accounts[i],s).messages[0].text,'updated');}await assert.rejects(f.apis[1].actGroup(g,key(),target,'delete'));await f.apis[0].actGroup(g,key(),target,'delete');await f.deliver(0,1);await f.deliver(0,2);assert(view(f.accounts[2],await f.apis[2].snapshot()).messages[0].deleted);await assert.rejects(f.apis[0].actGroup(g,key(),target,'edit','resurrect'));});

test('group reactions belong to individual members and removal changes only their choice',async()=>{const f=setup(),g=await f.group(),id=key(),target={id,author:f.accounts[0]};await f.apis[0].enqueueGroup(g,id,'original');await f.deliver(0,1);await f.deliver(0,2);await f.apis[1].actGroup(g,key(),target,'reaction','👍');await f.apis[2].actGroup(g,key(),target,'reaction','❤️');await f.deliver(1,0);await f.deliver(1,2);await f.deliver(2,0);await f.deliver(2,1);assert.equal(view(f.accounts[0],await f.apis[0].snapshot()).messages[0].reactions.length,2);await f.apis[1].actGroup(g,key(),target,'reaction','');await f.deliver(1,0);const choices=view(f.accounts[0],await f.apis[0].snapshot()).messages[0].reactions;assert.deepEqual(choices,[{author:f.accounts[2],text:'❤️'}]);});

test('out-of-order group actions wait for membership and tombstones survive original arriving later',async()=>{const f=setup(),g=key(),id=key(),target={id,author:f.accounts[0]};await f.apis[0].createGroup(g,key(),'Family',f.accounts.slice(1));await f.apis[0].enqueueGroup(g,id,'original');await f.apis[0].actGroup(g,key(),target,'delete');const packets=chat.pendingRootChat(await f.apis[0].snapshot(),f.accounts[0]).filter(p=>p.peer===f.accounts[1]),action=packets.find(p=>JSON.parse(p.raw)[0]==='axonic-root-group-action-v1'),invite=packets.find(p=>JSON.parse(p.raw)[0]==='axonic-group-members-v1'),message=packets.find(p=>JSON.parse(p.raw)[0]==='axonic-root-group-text-v1');assert.equal(await f.apis[1].receive(f.accounts[0],action.id,action.raw),false);assert(await f.apis[1].receive(f.accounts[0],invite.id,invite.raw));assert(await f.apis[1].receive(f.accounts[0],action.id,action.raw));assert(await f.apis[1].receive(f.accounts[0],message.id,message.raw));assert(view(f.accounts[1],await f.apis[1].snapshot()).messages[0].deleted);assert(await f.apis[1].receive(f.accounts[0],action.id,action.raw));assert.equal((await f.apis[1].snapshot()).groupActions.length,1);});

test('forged group actions, cross-group targets, future membership, changed retries and removal fail closed',async()=>{const f=setup(),g=await f.group(),id=key(),target={id,author:f.accounts[0]};await f.apis[0].enqueueGroup(g,id,'original');await f.deliver(0,1);await f.deliver(0,2);const aid=key();await f.apis[0].actGroup(g,aid,target,'edit','updated');await assert.rejects(f.apis[0].actGroup(g,aid,target,'edit','changed'));const p=chat.pendingRootChat(await f.apis[0].snapshot(),f.accounts[0]).find(p=>p.peer===f.accounts[1]),body=JSON.parse(p.raw);assert.equal(await f.apis[1].receive(f.accounts[2],p.id,p.raw),false);body[3].group.revision++;assert.equal(await f.apis[1].receive(f.accounts[0],p.id,JSON.stringify(body)),false);const other=key();await f.apis[0].createGroup(other,key(),'Other',f.accounts.slice(1));await assert.rejects(f.apis[0].actGroup(other,key(),target,'reaction','👍'));await f.apis[0].updateGroup(g,key(),'Family',[f.accounts[2]]);await f.deliver(0,1);assert.equal(await f.apis[1].receive(f.accounts[0],p.id,p.raw),false);await assert.rejects(f.apis[1].actGroup(g,key(),target,'reaction','👍'));});
test('group delivery IDs bind recipient and packet domain for the existing custody store',()=>{const id=key(),a='axonic:1:'+'a'.repeat(64),b='axonic:1:'+'b'.repeat(64);assert.equal(groups.rootGroupDeliveryId(id,a),groups.rootGroupDeliveryId(id,a));assert.notEqual(groups.rootGroupDeliveryId(id,a),groups.rootGroupDeliveryId(id,b));assert.notEqual(groups.rootGroupDeliveryId(id,a),groups.rootGroupDeliveryId(id,a,'axonic-group-members-v1'));});
test('malformed membership, too many members, future versions and forged creator updates fail closed',async()=>{const f=setup(),g=await f.group(),s=await f.apis[0].snapshot(),body={...s.groups[0]};delete body.accepted;delete body.blocked;const id=key(),wire=(from,value)=>JSON.stringify(['axonic-group-members-v1',f.accounts[1],id,value]);assert.equal(await f.apis[1].receive(f.accounts[2],id,wire(f.accounts[2],body)),false);assert.equal(await f.apis[1].receive(f.accounts[0],id,wire(f.accounts[0],{...body,members:[...body.members,body.members[0]]})),false);await assert.rejects(f.apis[0].updateGroup(g,key(),'x','a'.repeat(11).split('').map((_,i)=>'axonic:1:'+i.toString(16).repeat(64))));await f.apis[0].enqueueGroup(g,key(),'current');const p=chat.pendingRootChat(await f.apis[0].snapshot(),f.accounts[0]).find(p=>p.peer===f.accounts[1]),future=JSON.parse(p.raw);future[3].group.revision++;assert.equal(await f.apis[1].receive(f.accounts[0],p.id,JSON.stringify(future)),false);assert.deepEqual((await f.apis[1].snapshot()).groups[0].members,body.members);});
function setup(){const f=fixture(),accounts=f.ids.map(i=>i.record.account),raws=[null,null,null],apis=accounts.map((owner,i)=>chat.createRootChatLedger({owner,current:()=>true,now:()=>now,read:async()=>raws[i],write:async raw=>{raws[i]=raw;},verifyAttachment:async descriptor=>protocol.verifyAttachmentManifest(descriptor.manifest,f.ids[0].record,now),verifyAttachmentReceipt:async(descriptor,receipt)=>protocol.verifyAttachmentReceipt(receipt,descriptor.manifest,f.ids[1].record,now)}));return {...f,accounts,apis,raws,async deliver(i,j){for(const p of chat.pendingRootChat(await apis[i].snapshot(),accounts[i]).filter(p=>p.peer===accounts[j])){assert(await apis[j].receive(accounts[i],p.id,p.raw));await apis[i].delivered(p.peer,p.id);}},async group(){const id=key();await apis[0].createGroup(id,key(),'Family',accounts.slice(1));await this.deliver(0,1);await this.deliver(0,2);for(const a of apis)await a.configureGroup(id,{accepted:true});return id;}};}
test('group invitations and fan-out persist per-recipient receipts and do not become direct chats',async()=>{const f=setup(),g=await f.group(),id=key();await f.apis[0].enqueueGroup(g,id,'hello family');await f.deliver(0,1);let s=await f.apis[0].snapshot();assert.equal(groups.rootGroupMessages(s,g)[0].status,'pending');await f.deliver(0,2);s=await f.apis[0].snapshot();assert.equal(groups.rootGroupMessages(s,g).length,1);assert.equal(groups.rootGroupMessages(s,g)[0].status,'delivered');assert.equal(s.contacts.length,0);for(const a of f.apis)assert.equal(groups.rootGroupMessages(await a.snapshot(),g)[0].text,'hello family');});
test('out-of-order group text waits for membership and duplicates cannot change context or text',async()=>{const f=setup(),g=key(),id=key();await f.apis[0].createGroup(g,key(),'Family',f.accounts.slice(1));await f.apis[0].enqueueGroup(g,id,'queued');const p=chat.pendingRootChat(await f.apis[0].snapshot(),f.accounts[0]).find(p=>p.id===groups.rootGroupDeliveryId(id,f.accounts[1])&&p.peer===f.accounts[1]);assert.equal(await f.apis[1].receive(f.accounts[0],p.id,p.raw),false);const invite=chat.pendingRootChat(await f.apis[0].snapshot(),f.accounts[0]).find(p=>p.peer===f.accounts[1]&&p.id!==groups.rootGroupDeliveryId(id,f.accounts[1]));assert(await f.apis[1].receive(f.accounts[0],invite.id,invite.raw));assert(await f.apis[1].receive(f.accounts[0],p.id,p.raw));assert(await f.apis[1].receive(f.accounts[0],p.id,p.raw));const changed=JSON.parse(p.raw);changed[3].text='forged';assert.equal(await f.apis[1].receive(f.accounts[0],p.id,JSON.stringify(changed)),false);assert.equal((await f.apis[1].snapshot()).messages.length,1);});
test('only the authenticated creator changes membership; removal prevents future group fan-out',async()=>{const f=setup(),g=await f.group();await assert.rejects(f.apis[1].updateGroup(g,key(),'Hijack',f.accounts));const id=key();await f.apis[0].enqueueGroup(g,id,'before removal');await f.apis[0].updateGroup(g,key(),'Family',[f.accounts[1]]);assert(!chat.pendingRootChat(await f.apis[0].snapshot(),f.accounts[0]).some(p=>p.id===groups.rootGroupDeliveryId(id,f.accounts[2])&&p.peer===f.accounts[2]));await f.deliver(0,1);await f.deliver(0,2);await assert.rejects(f.apis[2].enqueueGroup(g,key(),'removed member'));await f.apis[1].enqueueGroup(g,key(),'remaining member');const p=chat.pendingRootChat(await f.apis[1].snapshot(),f.accounts[1])[0];assert(await f.apis[0].receive(f.accounts[1],p.id,p.raw));assert(!chat.pendingRootChat(await f.apis[1].snapshot(),f.accounts[1]).some(p=>p.peer===f.accounts[2]));});
test('leave retries cannot remove a subsequently re-added member',async()=>{const f=setup(),g=await f.group(),id=key();await f.apis[1].leaveGroup(g,id);const p=chat.pendingRootChat(await f.apis[1].snapshot(),f.accounts[1])[0];assert(await f.apis[0].receive(f.accounts[1],p.id,p.raw));await f.apis[0].updateGroup(g,key(),'Family',f.accounts.slice(1));assert(await f.apis[0].receive(f.accounts[1],p.id,p.raw));assert((await f.apis[0].snapshot()).groups[0].members.includes(f.accounts[1]));});
test('group media keeps the signed recipient-specific manifest and waits for its completion receipt',async()=>{const f=setup(),g=await f.group(),descriptor={manifest:f.manifest,key:Buffer.from(f.key).toString('hex'),checksum:crypto.createHash('sha256').update(f.plain).digest('hex'),name:'sample.bin',mime:'application/octet-stream'},context={id:g,revision:1,messageId:key()};await f.apis[0].enqueueAttachment(descriptor,undefined,context);const p=chat.pendingRootChat(await f.apis[0].snapshot(),f.accounts[0]).find(p=>p.id===f.manifest.id);assert(await f.apis[1].receive(f.accounts[0],p.id,p.raw));assert.equal(await f.apis[2].receive(f.accounts[0],p.id,p.raw),false);await f.apis[0].delivered(f.accounts[1],p.id);assert.equal((await f.apis[0].snapshot()).messages[0].status,'pending');const receipt=protocol.signAttachmentReceipt(f.manifest,f.ids[1].signingSeed,f.ids[1].record,now);assert(await f.apis[0].attachmentComplete(f.accounts[1],p.id,'outgoing',receipt));assert.equal((await f.apis[0].snapshot()).messages[0].status,'delivered');});
test('blocked groups and senders are local policy, and corrupt group storage is preserved',async()=>{const f=setup(),g=await f.group();await f.apis[1].configureGroup(g,{blocked:true});await f.apis[0].enqueueGroup(g,key(),'blocked');const p=chat.pendingRootChat(await f.apis[0].snapshot(),f.accounts[0])[0];assert.equal(await f.apis[1].receive(f.accounts[0],p.id,p.raw),false);const old=f.raws[0];f.raws[0]=JSON.stringify({...JSON.parse(old),groups:[{id:g}]});await assert.rejects(f.apis[0].snapshot(),/recovery/);assert.notEqual(f.raws[0],old);});

test('invalid local group preferences and null stored group rows preserve existing state',async()=>{const f=setup(),g=await f.group(),before=f.raws[0];for(const patch of [{accepted:'false'},{blocked:1},{unexpected:true},null]){await assert.rejects(f.apis[0].configureGroup(g,patch),/Invalid group preferences/);assert.equal(f.raws[0],before);}for(const bad of [{groups:[null]},{groupPackets:[null]}]){const raw=JSON.stringify({...JSON.parse(before),...bad});f.raws[0]=raw;await assert.rejects(f.apis[0].snapshot(),/recovery/);assert.equal(f.raws[0],raw);}});


test('group reads acknowledge each recipient independently, persist once and never create direct contacts',async()=>{
 const f=setup(),g=await f.group(),id=key();await f.apis[0].enqueueGroup(g,id,'read me');await f.deliver(0,1);await f.deliver(0,2);
 const shown=async()=>groups.rootGroupMessages(view(f.accounts[0],await f.apis[0].snapshot()),g)[0];
 await f.apis[1].markGroupRead(g);await f.apis[1].markGroupRead(g);
 assert.equal((await f.apis[1].snapshot()).groupActions.length,1);
 const pending=chat.pendingRootChat(await f.apis[1].snapshot(),f.accounts[1]);assert.equal(pending.length,1);assert.equal(pending[0].peer,f.accounts[0]);
 await f.deliver(1,0);assert.equal((await shown()).read,false);
 await f.apis[2].markGroupRead(g);await f.deliver(2,0);assert.equal((await shown()).read,true);
 for(const api of f.apis)assert.equal((await api.snapshot()).contacts.length,0);
});
test('group reads cannot acknowledge to another member or claim another reader',async()=>{
 const f=setup(),g=await f.group(),id=key();await f.apis[0].enqueueGroup(g,id,'read me');await f.deliver(0,1);await f.apis[1].markGroupRead(g);
 const p=chat.pendingRootChat(await f.apis[1].snapshot(),f.accounts[1])[0],body=JSON.parse(p.raw);
 body[3].target.author=f.accounts[2];assert.equal(await f.apis[0].receive(f.accounts[1],p.id,JSON.stringify(body)),false);
 body[3].target.author=f.accounts[0];body[3].revision=2;assert.equal(await f.apis[0].receive(f.accounts[1],p.id,JSON.stringify(body)),false);
 assert.equal(await f.apis[0].receive(f.accounts[2],p.id,p.raw),true);
 const messages=view(f.accounts[0],await f.apis[0].snapshot()).messages;assert.equal(messages.find(m=>m.peer===f.accounts[1]).read,false);assert.equal(messages.find(m=>m.peer===f.accounts[2]).read,true);
});
test('group mute survives membership updates without muting the same member in direct chat',async()=>{
 const f=setup(),g=await f.group();await f.apis[1].configureGroup(g,{muted:true});await f.apis[0].updateGroup(g,key(),'Renamed',f.accounts.slice(1));await f.deliver(0,1);
 const s=await f.apis[1].snapshot();assert.equal(s.groups[0].muted,true);assert.equal(s.contacts.length,0);await assert.rejects(f.apis[1].configureGroup(g,{muted:'yes'}));
});


test('creator photo uses authenticated encrypted group media, survives rename and clears explicitly',async()=>{
 const f=setup(),g=await f.group(),photo=key(),descriptor={manifest:f.manifest,key:Buffer.from(f.key).toString('hex'),checksum:crypto.createHash('sha256').update(f.plain).digest('hex'),name:'photo.jpg',mime:'image/jpeg'};
 await assert.rejects(f.apis[0].updateGroup(g,key(),'Family',f.accounts.slice(1),photo));
 await f.apis[0].enqueueAttachment(descriptor,undefined,{id:g,revision:1,messageId:photo});await f.apis[0].updateGroup(g,key(),'Family',f.accounts.slice(1),photo);await f.deliver(0,1);
 let s=await f.apis[1].snapshot();assert.equal(groups.rootGroupPhoto(s,g,f.accounts[1]).attachment.manifest.id,f.manifest.id);
 await assert.rejects(f.apis[1].updateGroup(g,key(),'Family',f.accounts,photo));
 await f.apis[0].updateGroup(g,key(),'Renamed',f.accounts.slice(1));await f.deliver(0,1);assert.equal((await f.apis[1].snapshot()).groups[0].photo,photo);
 await f.apis[0].updateGroup(g,key(),'Renamed',f.accounts.slice(1),null);await f.deliver(0,1);s=await f.apis[1].snapshot();assert.equal(groups.rootGroupPhoto(s,g,f.accounts[1]),null);
 assert.equal(s.messages.length,1); // Removing the avatar never deletes a shared chat attachment.
});
