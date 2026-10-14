const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./helpers/attachment.cjs');
const p=load('rootProfileProtocol'),chat=load('rootChatLedger');
const root=new Uint8Array(32).fill(41),other=new Uint8Array(32).fill(42),now=Date.now();
const jpeg=n=>Uint8Array.from([255,216,255,192,0,11,8,0,128,0,128,1,1,17,0,...new Array(n).fill(7),255,217]);
const image=p.signProfile(jpeg(2300),now,root),sender=load('identityProtocol').accountId(image.manifest.root);
const recipient=load('identityProtocol').accountId(p.signProfile(new Uint8Array(),now,other).manifest.root);
test('acknowledged avatar packets are omitted without changing remaining wire bytes',()=>{
 const all=p.profilePackets(sender,recipient,image,[]),acked=[0,2];
 assert.deepEqual(p.profilePackets(sender,recipient,image,acked),all.filter(row=>!acked.includes(row.index)));
 assert.deepEqual(p.profilePackets(sender,recipient,image,all.map(row=>row.index)),[]);
});
test('changed avatar bytes are revalidated after a successful ledger read',async()=>{
 let raw=JSON.stringify({version:1,messages:[],contacts:[],ownProfile:image});
 const api=chat.createRootChatLedger({owner:sender,read:async()=>raw,write:async value=>{raw=value;},current:()=>true,now:Date.now});
 await api.snapshot();await api.snapshot();
 raw=JSON.stringify({version:1,messages:[],contacts:[],ownProfile:{...image,data:'00'+image.data.slice(2)}});
 await assert.rejects(api.snapshot(),/needs recovery/);
});
function ledger(owner){let raw=null,cache={},clock=now;const make=()=>chat.createRootChatLedger({owner,read:async()=>raw,write:async v=>{raw=v;},current:()=>true,now:()=>clock,receiveProfile:async(from,id,part)=>{const next=p.receiveProfilePart(cache,from,owner,id,part,clock);if(!next)return false;cache=next;return true;}});let api=make();return {get api(){return api;},restart(){api=make();},get cache(){return cache;}};}
async function pair(){const a=ledger(sender),b=ledger(recipient);await a.api.configure(recipient,{accepted:true});await b.api.configure(sender,{accepted:true});await a.api.rememberProfilePeers([recipient]);await b.api.rememberProfilePeers([sender]);await a.api.publishProfile(image);return {a,b};}
test('signed avatar is bounded, private to eligible peers and uses stable sub-2KB packets',async()=>{const {a}=await pair();const packets=chat.pendingRootChat(await a.api.snapshot(),sender);assert.equal(packets.length,p.profileCount(image.manifest));for(const row of packets){assert.ok(Buffer.byteLength(row.raw)<=2048);assert.equal(row.peer,recipient);}assert.equal((await a.api.snapshot()).messages.length,0);await a.api.configure(recipient,{blocked:true});assert.equal(chat.pendingRootChat(await a.api.snapshot(),sender).length,0);});
test('offline avatar resumes after restart and accepts reordered duplicate packets without visible messages',async()=>{const {a,b}=await pair();let packets=chat.pendingRootChat(await a.api.snapshot(),sender).reverse();const first=packets.shift();assert.equal(await b.api.receive(sender,first.id,first.raw),true);await a.api.delivered(recipient,first.id);a.restart();b.restart();assert.equal(chat.pendingRootChat(await a.api.snapshot(),sender).length,packets.length);for(const row of packets){assert.equal(await b.api.receive(sender,row.id,row.raw),true);assert.equal(await b.api.receive(sender,row.id,row.raw),true);await a.api.delivered(recipient,row.id);}assert.deepEqual(b.cache.current,image);assert.equal(chat.pendingRootChat(await a.api.snapshot(),sender).length,0);assert.equal((await b.api.snapshot()).messages.length,0);});
test('avatar rejects spoofing, tampering, conflicting same-version content, and oversized dimensions',()=>{const rows=p.profilePackets(sender,recipient,image,[]),part=JSON.parse(rows[0].raw)[3];assert.equal(p.receiveProfilePart({},recipient,recipient,rows[0].id,part,now),null);assert.equal(p.receiveProfilePart({},sender,recipient,rows[0].id,{...part,manifest:{...part.manifest,signature:'00'.repeat(64)}},now),null);const changed=p.signProfile(jpeg(1),now,root);assert.equal(p.receiveProfilePart({current:image},sender,recipient,p.profilePartId(sender,recipient,changed.manifest,0),JSON.parse(p.profilePackets(sender,recipient,changed,[])[0].raw)[3],now),null);const huge=jpeg(1);huge[9]=2;assert.throws(()=>p.signProfile(huge,now,root));assert.throws(()=>p.signProfile(jpeg(20000),now,root));});
test('a corrupted chunk cannot become a cached avatar',()=>{let cache={};const rows=p.profilePackets(sender,recipient,image,[]);for(let i=0;i<rows.length;i++){const part=JSON.parse(rows[i].raw)[3];if(i===0)part.data='00'+part.data.slice(2);const next=p.receiveProfilePart(cache,sender,recipient,rows[i].id,part,now);if(i===rows.length-1)assert.equal(next,null);else {assert.ok(next);cache=next;}}assert.equal(cache.current,undefined);});
test('newer avatar/removal wins over delayed older packets and preserves nicknames',async()=>{const {a,b}=await pair();await b.api.configure(sender,{alias:'My friend'});let cache={current:image};const removed=p.signProfile(new Uint8Array(),now+1,root),row=p.profilePackets(sender,recipient,removed,[])[0];cache=p.receiveProfilePart(cache,sender,recipient,row.id,JSON.parse(row.raw)[3],now+1);assert.equal(cache.current.data,'');const old=p.profilePackets(sender,recipient,image,[])[0];assert.equal(p.receiveProfilePart(cache,sender,recipient,old.id,JSON.parse(old.raw)[3],now+1),cache);await a.api.publishProfile(removed);assert.equal((await b.api.snapshot()).contacts[0].alias,'My friend');});
test('request recovers an avatar after all prior packets were delivered without resending unchanged content',async()=>{const {a,b}=await pair();for(const row of chat.pendingRootChat(await a.api.snapshot(),sender))await a.api.delivered(recipient,row.id);await b.api.requestProfile(sender,'a'.repeat(64),image.manifest.hash);let row=chat.pendingRootChat(await b.api.snapshot(),recipient)[0];assert.equal(await a.api.receive(recipient,row.id,row.raw),true);assert.equal(chat.pendingRootChat(await a.api.snapshot(),sender).length,0);await b.api.delivered(sender,row.id);await b.api.requestProfile(sender,'b'.repeat(64),null);row=chat.pendingRootChat(await b.api.snapshot(),recipient)[0];assert.equal(await a.api.receive(recipient,row.id,row.raw),true);assert.equal(chat.pendingRootChat(await a.api.snapshot(),sender).length,p.profileCount(image.manifest));});
test('unknown users, blocked users and clients without avatar capability are not sent photos',async()=>{const a=ledger(sender);await a.api.publishProfile(image);await a.api.configure(recipient,{accepted:true});assert.equal(chat.pendingRootChat(await a.api.snapshot(),sender).length,0);const b=ledger(recipient),row=p.profilePackets(sender,recipient,image,[])[0];assert.equal(await b.api.receive(sender,row.id,row.raw),false);await b.api.configure(sender,{accepted:true,blocked:true});assert.equal(await b.api.receive(sender,row.id,row.raw),false);});
test('custody receipt lookup recognizes avatar packets without accepting another recipient or ID',async()=>{const {a}=await pair(),s=await a.api.snapshot(),row=chat.pendingRootChat(s,sender)[0],known=load('rootProfileSharing').knownProfileReceipt;assert.equal(known(s,sender,recipient,row.id),true);assert.equal(known(s,sender,sender,row.id),false);assert.equal(known(s,sender,recipient,'f'.repeat(64)),false);await a.api.delivered(recipient,row.id);assert.equal(known(await a.api.snapshot(),sender,recipient,row.id),true);});

test('modern peers receive no unsolicited image packets; an authenticated request releases the image',async()=>{
 const {a,b}=await pair();await a.api.rememberProfileOfferPeers([recipient]);assert.equal(chat.pendingRootChat(await a.api.snapshot(),sender).length,0);
 await b.api.requestProfile(sender,'c'.repeat(64),null);const request=chat.pendingRootChat(await b.api.snapshot(),recipient)[0];
 assert(await a.api.receive(recipient,request.id,request.raw));assert.equal(chat.pendingRootChat(await a.api.snapshot(),sender).length,p.profileCount(image.manifest));
 const row=chat.pendingRootChat(await a.api.snapshot(),sender)[0];await a.api.delivered(recipient,row.id);
 assert(await a.api.receive(recipient,request.id,request.raw));assert.equal(chat.pendingRootChat(await a.api.snapshot(),sender).length,p.profileCount(image.manifest),'lost partial cache can fetch all bytes again');
});
test('delayed fetch for an older offer cannot resend the current avatar revision',async()=>{
 const {a}=await pair();await a.api.rememberProfileOfferPeers([recipient]);
 const requestId='d'.repeat(64),wire=JSON.stringify(['axonic-avatar-fetch-v1',sender,requestId,{known:null,revision:image.manifest.revision,hash:image.manifest.hash}]);
 await a.api.publishProfile(p.signProfile(jpeg(2300),now+1,root));
 assert(await a.api.receive(recipient,requestId,wire));assert.equal(chat.pendingRootChat(await a.api.snapshot(),sender).length,0);
});
test('signed offers update matching revisions and removals without bytes and reject rollback/tampering',()=>{
 const same=p.signProfile(jpeg(2300),now+1,root),removed=p.signProfile(new Uint8Array(),now+2,root);
 const updated=p.receiveProfileOffer({current:image},sender,same.manifest,now+2);assert.deepEqual(updated.current,same);
 const cleared=p.receiveProfileOffer(updated,sender,removed.manifest,now+2);assert.deepEqual(cleared.current,removed);
 assert.equal(p.receiveProfileOffer(cleared,sender,image.manifest,now+2),cleared);
 assert.equal(p.receiveProfileOffer({},sender,{...image.manifest,hash:'0'.repeat(64)},now),null);
 assert.equal(p.receiveProfileOffer({},recipient,image.manifest,now),null);
 const pending=p.receiveProfileOffer({},sender,image.manifest,now);assert.equal(pending.pending.parts.length,p.profileCount(image.manifest));
});
test('accepted offer queues one version-bound fetch; unknown or blocked contacts cannot trigger storage',async()=>{
 let raw=null,called=0;const api=chat.createRootChatLedger({owner:recipient,current:()=>true,now:()=>now,read:async()=>raw,write:async v=>{raw=v;},receiveProfileOffer:async()=>{called++;return {known:null,needed:true};}});
 const id=p.profileOfferId(sender,recipient,image.manifest),wire=JSON.stringify(['axonic-avatar-offer-v1',recipient,id,image.manifest]);
 assert.equal(await api.receive(sender,id,wire),false);assert.equal(called,0);
 await api.configure(sender,{accepted:true});assert(await api.receive(sender,id,wire));assert.equal(chat.pendingRootChat(await api.snapshot(),recipient).length,1);
 assert(await api.receive(sender,id,wire));assert.equal(chat.pendingRootChat(await api.snapshot(),recipient).length,1);
 await api.configure(sender,{blocked:true});assert.equal(await api.receive(sender,id,wire),false);assert.equal(called,2);
});
