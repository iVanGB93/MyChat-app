const test=require('node:test'),assert=require('node:assert/strict');
const {load,fixture}=require('./helpers/attachment.cjs');
const {createRelayBlockStream}=load('relayBlockStream');
const batch=load('attachmentBatch'),protocol=load('attachmentProtocol');
function pair(t,deliver=async()=>{}){
 const frames=[[],[]],received=[[],[]],errors=[];let live=true;
 const peers=[0,1].map(i=>createRelayBlockStream({current:()=>live,
  send:f=>{frames[i].push(f);queueMicrotask(()=>peers[1-i].receive(f).then(ok=>{if(!ok)errors.push(f);},e=>errors.push(e)));},
  deliver:async f=>{received[i].push(f);await deliver(f,i);}}));
 t.after(()=>peers.forEach(p=>p.stop()));return {peers,frames,received,errors,lock:()=>live=false};
}
test('streams signed encrypted blocks unchanged in both directions for 1, 5 and 10 MiB files',async t=>{
 const f=pair(t);
 for(const size of [1,5,10]){
  const v=fixture(size*1024*1024);
  for(const chunk of v.chunks){
   const data=batch.packAttachmentBatch(v.manifest,chunk.index,[chunk]);
   for(const direction of ['bulk-request','bulk-response']){
    const body=direction==='bulk-request'?{version:1,operation:'put-batch',digest:protocol.attachmentDigest(v.manifest),index:chunk.index,count:1,data}:{status:'ok',index:chunk.index,count:1,data};
    const frame={kind:direction,id:100+chunk.index,body:JSON.stringify(body)};
    assert.equal(await f.peers[0].transmit(frame),true);
    const result=JSON.parse(f.received[1].at(-1).body);
    assert.deepEqual(result,body);
    assert.deepEqual(batch.unpackAttachmentBatch(v.manifest,chunk.index,1,result.data),[chunk]);
    assert.equal(protocol.verifyAttachmentChunk(v.manifest,chunk),true);
   }
  }
 }
 assert.deepEqual(f.errors,[]);
 assert.ok(f.frames.flat().every(v=>JSON.stringify(v).length<12000));
});
test('final credit waits for consumer completion; no complete block on interruption',async t=>{
 let release;const gate=new Promise(r=>release=r),f=pair(t,()=>gate);
 const frame={kind:'bulk-response',id:1,body:JSON.stringify({status:'ok',index:0,count:1,data:'A'.repeat(32000)})};
 let done=false;const sending=f.peers[0].transmit(frame).then(()=>done=true);
 await new Promise(r=>setImmediate(r));assert.equal(done,false);release();await sending;assert.equal(done,true);
 const sent=[],receiver=createRelayBlockStream({current:()=>true,send:v=>sent.push(v),deliver:async()=>assert.fail('partial delivered')});t.after(()=>receiver.stop());
 assert.equal(await receiver.receive({version:1,kind:'relay-block-stream',op:'start',direction:'bulk-response',id:2,size:32000,header:{status:'ok',index:0,count:1}}),true);
 assert.equal(await receiver.receive({version:1,kind:'relay-block-stream',op:'data',direction:'bulk-response',id:2,offset:0,data:'A'.repeat(8000)}),true);
 receiver.stop();assert.equal(sent.length,1);
});
test('rejects oversized, unsolicited, duplicate, out-of-order and invalid records',async t=>{
 const r=createRelayBlockStream({current:()=>true,send:()=>{},deliver:async()=>{},admit:(_,id)=>id!==9});t.after(()=>r.stop());
 const start={version:1,kind:'relay-block-stream',op:'start',direction:'bulk-response',id:1,size:32000,header:{status:'ok',index:0,count:1}};
 assert.equal(await r.receive({...start,size:5000000}),false);
 assert.equal(await r.receive({...start,id:9}),false);
 assert.equal(await r.receive(start),true);assert.equal(await r.receive(start),false);
 const data={version:1,kind:'relay-block-stream',op:'data',direction:'bulk-response',id:1,offset:0,data:'A'.repeat(8000)};
 for(const v of [{...data,offset:8000},{...data,data:'?' .repeat(8000)},{...data,extra:1},{...data,data:'A'.repeat(8001)}])assert.equal(await r.receive(v),false);
 assert.equal(await r.receive(data),true);assert.equal(await r.receive(data),false);
 assert.equal(await r.receive({...start,id:2}),true);assert.equal(await r.receive({...start,id:3}),false);
});
test('receiver credit bounds sender outstanding records and stop rejects pending work',async t=>{
 const sent=[],r=createRelayBlockStream({current:()=>true,send:v=>sent.push(v),deliver:async()=>{}});t.after(()=>r.stop());
 const task=r.transmit({kind:'bulk-response',id:1,body:JSON.stringify({status:'ok',index:0,count:1,data:'A'.repeat(800000)})});
 assert.equal(sent.length,1);
 await r.receive({version:1,kind:'relay-block-stream',op:'credit',direction:'bulk-response',id:1,offset:0});
 await new Promise(r=>setImmediate(r));assert.equal(sent.filter(v=>v.op==='data').length,32);
 const rejected=assert.rejects(task,/closed/);r.stop();await rejected;
});
test('timeout drops partial buffers and tolerates bounded late traffic without a false completion',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const r=createRelayBlockStream({current:()=>true,send:()=>{},deliver:async()=>assert.fail('partial delivered')});t.after(()=>r.stop());
 const sending=r.transmit({kind:'bulk-response',id:1,body:JSON.stringify({status:'ok',index:0,count:1,data:'A'.repeat(32000)})});
 const rejected=assert.rejects(sending,/timed out/);
 const start={version:1,kind:'relay-block-stream',op:'start',direction:'bulk-request',id:2,size:32000,header:{version:1,operation:'put-batch',digest:'a'.repeat(64),index:0,count:1}};
 assert.equal(await r.receive(start),true);
 t.mock.timers.tick(15001);await rejected;
 assert.equal(await r.receive({version:1,kind:'relay-block-stream',op:'credit',direction:'bulk-response',id:1,offset:32000}),true);
 assert.equal(await r.receive({version:1,kind:'relay-block-stream',op:'data',direction:'bulk-request',id:2,offset:0,data:'A'.repeat(8000)}),true);
 assert.equal(await r.receive({...start,id:3}),true);
});

test('unaligned or ahead-of-send credits cannot expand the byte window',async t=>{
 const sent=[],r=createRelayBlockStream({current:()=>true,send:f=>sent.push(f),deliver:async()=>{}});t.after(()=>r.stop());
 const task=r.transmit({kind:'bulk-response',id:1,body:JSON.stringify({status:'ok',index:0,count:1,data:'A'.repeat(800000)})});
 const credit={version:1,kind:'relay-block-stream',op:'credit',direction:'bulk-response',id:1,offset:0};
 assert(await r.receive(credit));await new Promise(r=>setImmediate(r));
 for(const offset of [1,7999,256001,264000])assert.equal(await r.receive({...credit,offset}),false);
 assert.equal(sent.filter(f=>f.op==='data').length,32);
 assert(await r.receive({...credit,offset:32000}));await new Promise(r=>setImmediate(r));
 assert.equal(sent.filter(f=>f.op==='data').length,36);
 const rejected=assert.rejects(task,/closed/);r.stop();await rejected;
});
