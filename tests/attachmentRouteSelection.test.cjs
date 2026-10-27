const test=require('node:test'),assert=require('node:assert/strict');
const {load,fixture,now}=require('./helpers/attachment.cjs');
const r=load('attachmentRouteSelection'),f=fixture(16);
const [sender,owner,relay]=f.ids.map(i=>i.record.account),other='axonic:1:'+'ab'.repeat(32);
const job=(patch={})=>({direction:'incoming',owner,cursor:0,relay:null,descriptor:{manifest:f.manifest},...patch});
const snapshot=(patch={})=>({peers:[relay,sender],blocks:[relay],shared:[],bulk:[relay],uploads:[relay],bulkRequest:true,directStream:true,...patch});
const rank=(j,s,cooldown=new Map(),retry=0)=>r.attachmentRouteCandidates(j,s,now,cooldown,retry);
test('scheduling waits for capabilities, but preserves local completion and direct status work',()=>{
 assert.equal(r.attachmentCanAdvance(job(),snapshot({directStream:false,blocks:[]}),now),false);
 assert.equal(r.attachmentCanAdvance(job(),snapshot(),now),true);
 assert.equal(r.attachmentCanAdvance(job({cursor:1}),snapshot({peers:[]}),now),true);
 assert.equal(r.attachmentCanAdvance(job({direction:'outgoing',owner:sender}),snapshot({peers:[owner],blocks:[]}),now),true);
 const receipt=job({receipt:{},custodians:[relay],acknowledged:[]});
 assert.equal(r.attachmentCanAdvance(receipt,snapshot({peers:[]}),now),false);
 assert.equal(r.attachmentCanAdvance(receipt,snapshot({peers:[relay],blocks:[]}),now),true);
 assert.equal(r.attachmentCanAdvance({...receipt,acknowledged:[relay]},snapshot({peers:[]}),now),true);
});

test('direct sender wins without relay capability, including shared media; custodians need it',()=>{
 const j=job({descriptor:{manifest:{...f.manifest,shared:{}}}});
 assert.deepEqual(rank(j,snapshot()),[sender]);
 assert.deepEqual(rank(j,snapshot({shared:[relay]})),[sender,relay]);
 assert.deepEqual(rank(j,snapshot({directStream:false})),[]);
});
test('retry deadline suppresses stream exception, and expired failures stay below untried routes',()=>{
 assert.deepEqual(rank(job(),snapshot(),new Map(),now+1),[relay]);
 assert.deepEqual(rank(job(),snapshot(),new Map(),now),[sender,relay]);
 assert.deepEqual(rank(job(),snapshot({blocks:[relay,sender]}),new Map([[sender,now-1]])),[relay,sender]);
 assert.deepEqual(rank(job(),snapshot(),new Map([[sender,now+1]])),[relay]);
 assert.equal(r.attachmentStreamEligible(job({cursor:1}),sender,true,now,0),false);
});
test('retain current route, upgrade to sender, reject disconnected route without mutating checkpoint',()=>{
 const j=Object.freeze(job({relay}));
 assert.equal(r.attachmentRouteNeedsSelection(j,[relay,sender]),false);
 assert.equal(r.attachmentRouteNeedsSelection(j,[sender,relay]),true);
 assert.equal(r.attachmentRouteNeedsSelection(j,[]),true);
 assert.equal(j.relay,relay);assert.equal(j.cursor,0);
});
test('outgoing selection excludes self, recipient and invalid identities; respects bounded candidates',()=>{
 const many=Array.from({length:14},(_,i)=>'axonic:1:'+i.toString(16).padStart(64,'0'));
 const peers=[sender,owner,'invalid',...many];
 assert.deepEqual(rank(job({direction:'outgoing',owner:sender}),snapshot({peers,blocks:peers})),many.slice(0,10));
});
test('shared upload chooses prior eligible sibling custodian, excludes audience, preserves input order',()=>{
 const peers=Object.freeze([sender,relay,other]);
 assert.equal(r.selectAttachmentCustodian(peers,[{recipient:sender,relay:other}]),other);
 assert.equal(r.selectAttachmentCustodian(peers,[{recipient:sender,relay:'gone'}]),relay);
 assert.equal(r.selectAttachmentCustodian([sender],[{recipient:sender,relay:null}]),sender);
 assert.deepEqual(peers,[sender,relay,other]);
});
test('receipt routes need a connection and elapsed cooldown, not payload capabilities',()=>{
 assert.equal(r.selectAttachmentReceiptPeer([sender,relay],[sender,relay],now,new Map([[sender,now+1]])),relay);
 assert.equal(r.selectAttachmentReceiptPeer([sender],[],now,new Map()),undefined);
 assert.equal(r.selectAttachmentReceiptPeer([sender],[sender],now,new Map([[sender,now]])),sender);
});
test('capabilities are observed afresh and snapshots cannot mutate provider arrays',()=>{
 let peers=[relay],blocks=[relay];
 const c={peers:()=>peers,blockStreamPeers:()=>blocks,request:()=>{throw Error('selection must not send');}};
 const first=r.attachmentRouteSnapshot(c,false);peers.push(sender);blocks.length=0;
 assert.deepEqual(first.peers,[relay]);assert.deepEqual(first.blocks,[relay]);
 const second=r.attachmentRouteSnapshot(c,true);
 assert.deepEqual(second.peers,[relay,sender]);assert.deepEqual(second.blocks,[]);
 assert.equal(r.attachmentBlockRoute(snapshot(),relay,'incoming'),true);
 assert.equal(r.attachmentBlockRoute(snapshot({blocks:[]}),relay,'incoming'),false);
 assert.equal(r.attachmentBlockRoute(snapshot({uploads:[]}),relay,'outgoing'),false);
 assert.equal(r.attachmentBlockRoute(snapshot({bulkRequest:false}),relay,'outgoing'),false);
});
