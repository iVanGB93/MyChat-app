const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
function harness(custom=true,failConfig=false){
  const effects=[],cleanups=[],sent=[],legacySent=[],pcs=[];
  let configReads=0,subscriptions=0,listener,closed=0,stopped=0,disconnected=0;
  const track={kind:'audio',stop(){stopped++;}},stream={getTracks:()=>[track]};
  class PC {
    constructor(config){this.config=config;this.iceGatheringState='complete';pcs.push(this);}
    addTrack(){} getStats(){return Promise.resolve(new Map());} getSenders(){return [];}
    createOffer(){return Promise.resolve({type:'offer',sdp:'v=0'});}
    createAnswer(){return Promise.resolve({type:'answer',sdp:'v=0'});}
    setLocalDescription(d){this.localDescription={...d,toJSON:()=>d};
      this.onicecandidate?.({candidate:{toJSON:()=>({candidate:'candidate:1 1 UDP 1 127.0.0.1 1234 typ host',sdpMid:'0',sdpMLineIndex:0})}});
      return Promise.resolve();}
    setRemoteDescription(d){this.remoteDescription=d;return Promise.resolve();}
    close(){closed++;}
  }
  const code=ts.transpileModule(fs.readFileSync('src/hooks/useWebRTC.ts','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  new Function('require','exports',code)(name=>{
    if(name==='react')return {useRef:v=>({current:v}),useCallback:f=>f,useEffect:f=>effects.push(f),useState:v=>[v,()=>{}]};
    if(name==='react-native-webrtc')return {RTCPeerConnection:PC,RTCSessionDescription:class {constructor(d){Object.assign(this,d);}},
      RTCIceCandidate:class {constructor(d){Object.assign(this,d);}},mediaDevices:{getUserMedia:async()=>stream}};
    if(name.includes('NotificationContext'))return {useNotificationContext:()=>({sendSignal:(...args)=>legacySent.push(args),
      subscribe:fn=>{subscriptions++;listener=fn;return ()=>{listener=null;};}})};
    if(name.includes('callService'))return {getIceConfig:async()=>{configReads++;return {ice_servers:[],ice_transport_policy:'all'};}};
    if(name.includes('diagnostics'))return {debugLog:()=>{}};
    return require('../src/services/'+name.split('/').at(-1)+'.ts');
  },exports);
  const transport={send:async(...args)=>{sent.push(args);return true;},subscribe:fn=>{listener=fn;return()=>{listener=null;};},
    loadIceConfig:async()=>{if(failConfig)throw Error('unavailable');return {ice_servers:[],ice_transport_policy:'all'};}};
  const hook=exports.default({callId:'one-call',peerUserId:14,callType:'voice',isOutgoing:true,
    mediaTransport:custom?transport:undefined,onDisconnected:()=>{disconnected++;}});
  for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}
  return {hook,sent,legacySent,pcs,emit:(...a)=>listener?.(...a),unmount:()=>cleanups.forEach(f=>f()),
    counts:()=>({configReads,subscriptions,closed,stopped,disconnected})};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('neuron adapter exclusively owns signaling and ICE; cleanup stops native media',async()=>{
  const h=harness();
  try {
    await h.hook.startAsOfferer();await settle();
    assert.deepEqual(h.sent.map(e=>e[0]),['offer'],'gathered ICE cannot queue ahead of the neuron offer');assert.deepEqual(h.legacySent,[]);
    assert.equal(h.counts().configReads,0);assert.equal(h.counts().subscriptions,0);assert.equal(h.pcs[0].config.bundlePolicy,'max-bundle');
    h.emit('answer',{type:'answer',sdp:'v=0'});await settle();
    assert.equal(h.pcs[0].remoteDescription.type,'answer');
  } finally {h.unmount();}
  assert.equal(h.counts().closed,1);assert.equal(h.counts().stopped,1);
  const count=h.sent.length;h.pcs[0].onicecandidate({candidate:{toJSON:()=>({candidate:'late'})}});
  await settle();assert.equal(h.sent.length,count);
});
test('legacy adapter still scopes outgoing calls and ignores another call answer',async()=>{
  const h=harness(false);
  try {
    await h.hook.startAsOfferer();await settle();
    assert.equal(h.legacySent[0][2].axonic_call_id,'one-call');
    assert.deepEqual(h.legacySent.map(e=>e[1]),['ice-candidate','offer']);
    assert.equal(h.counts().configReads,1);assert.equal(h.counts().subscriptions,1);
    h.emit({event:'webrtc_signal',signal_type:'answer',from_user_id:14,data:{type:'answer',sdp:'v=0',axonic_call_id:'another-call'}});
    await settle();assert.equal(h.pcs[0].remoteDescription,undefined);
  } finally {h.unmount();}
});
test('failed neuron ICE config fails closed without Django fallback or peer creation',async()=>{
  const h=harness(true,true);
  try {
    await settle();await h.hook.startAsOfferer();await settle();
    assert.equal(h.pcs.length,0);assert.equal(h.sent.length,0);assert.equal(h.legacySent.length,0);
    assert.equal(h.counts().configReads,0);assert.equal(h.counts().disconnected,1);
  } finally {h.unmount();}
});
