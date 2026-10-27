const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
const api={};new Function('exports',ts.transpileModule(fs.readFileSync('src/services/callPeerSelection.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(api);
const {createCallPeerSelection:make,callPeerMode,callPeerDescription}=api;
const sdp=n=>'v=0\r\na=fingerprint:sha-256 '+Array(32).fill(n).join(':')+'\r\n';
function fixture(acquire){let live=true,created=0,closed=0,configs=0;const cfg={ice_servers:[],ice_transport_policy:'relay'};return {deps:{id:'a'.repeat(64),current:()=>live,graceMs:5,acquire,loadIceConfig:async()=>{configs++;return cfg;},create:actual=>{assert.equal(actual,cfg);created++;return {close(){closed++;}};}},stop:()=>live=false,state:()=>({created,closed,configs})};}
test('shared connection is preferred and never closed by call cleanup',async()=>{
 let released=0;const shared={connection:{},current:()=>true,channelLabel:'call',validateRemote:()=>true,release:()=>released++};
 const f=fixture(async()=>shared),p=make(f.deps);const lease=await p.select('prefer-shared');assert.equal(lease.mode,'shared');assert.equal(lease.connection,shared.connection);p.stop();lease.release();lease.release();assert.equal(released,1);assert.equal(f.state().created,0);
});
test('failed acquisition uses call-owned ICE and pins authenticated peer certificate',async()=>{
 const f=fixture(async()=>{throw Error('No direct route');}),p=make(f.deps),lease=await p.select('prefer-shared');assert.equal(lease.mode,'dedicated');assert.equal(f.state().configs,1);
 assert.equal(lease.validateRemote('v=0\r\n'),false);assert(lease.validateRemote(sdp('AA')));assert(lease.validateRemote(sdp('AA')));assert.equal(lease.validateRemote(sdp('BB')),false);
 p.stop();assert.equal(lease.validateRemote(sdp('AA')),false);lease.release();lease.release();assert.equal(f.state().closed,1);
});
test('late shared acquisition is released after bounded TURN fallback',async()=>{
 let resolve,released=0;const f=fixture(()=>new Promise(r=>resolve=r)),p=make(f.deps);const lease=await p.select('prefer-shared');assert.equal(lease.mode,'dedicated');resolve({release:()=>released++,current:()=>true});await p.warm();assert.equal(released,1);lease.release();
});
test('answerer obeys dedicated offer despite an available shared connection',async()=>{
 let released=0;const f=fixture(async()=>({release:()=>released++,current:()=>true})),p=make(f.deps);await p.warm();const lease=await p.select('dedicated');assert.equal(released,1);assert.equal(lease.mode,'dedicated');await assert.rejects(p.select('shared'),/mode changed/);lease.release();
});
test('shared offer cannot silently become a different certificate/connection',async()=>{
 const f=fixture(async()=>{throw Error('Missing shared peer');});await assert.rejects(make(f.deps).select('shared'),/unavailable/);assert.equal(f.state().created,0);
});
test('ending during ICE lookup never creates a peer',async()=>{
 let resolve;const f=fixture(),p=make({...f.deps,loadIceConfig:()=>new Promise(r=>resolve=r)});const pending=p.select('dedicated');await Promise.resolve();p.stop();resolve({});await assert.rejects(pending,/ended/);assert.equal(f.state().created,0);
});
test('ending before warm microtask creates no acquisition',async()=>{
 let called=0;const f=fixture(async()=>{called++;return null;}),p=make(f.deps);const warm=p.warm();p.stop();await warm;assert.equal(called,0);
});
test('signed SDP mode is explicit, canonical, rejects duplicates, and defaults old standalone callers',()=>{
 assert.equal(callPeerMode(sdp('AA')),'dedicated');for(const mode of ['shared','dedicated']){const d=callPeerDescription({type:'offer',sdp:sdp('AA')},mode);assert.equal(callPeerMode(d.sdp),mode);assert.equal(d.type,'offer');assert.equal(callPeerDescription(d,mode).sdp,d.sdp);}
 assert.throws(()=>callPeerMode(sdp('AA')+'a=x-axonic-call-peer:other\r\n'));
 assert.throws(()=>callPeerMode(sdp('AA')+'a=x-axonic-call-peer:shared\r\na=x-axonic-call-peer:shared\r\n'));
});
