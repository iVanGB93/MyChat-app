const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {patch,patchPeer}=require('../scripts/patch-webrtc-identity.cjs');
const installed=()=>fs.readFileSync('node_modules/react-native-webrtc/android/src/main/java/com/oney/WebRTCModule/DataChannelWrapper.java','utf8');
test('native identity patch is repeatable and rejects dependency drift or tampering',()=>{
  const result=patch(installed(),'124.0.7');
  assert.equal(patch(result,'124.0.7'),result);
  assert.throws(()=>patch(result,'125.0.0'),/Review/);
  assert.throws(()=>patch(result.replace('20_000','30_000').replace('axonicGuard.receive','axonicGuard.bypass'),'124.0.7'),/Unexpected|Partial/);
  assert.throws(()=>patch(result+'\n// unexpected upstream change','124.0.7'),/Unexpected/);
});
test('native peer policy is pinned, repeatable and gates unknown channels before bridge registration',()=>{
  for(const name of ['PeerConnectionObserver.java','WebRTCModule.java']){
    const source=fs.readFileSync('node_modules/react-native-webrtc/android/src/main/java/com/oney/WebRTCModule/'+name,'utf8');
    const result=patchPeer(source,name);assert.equal(patchPeer(result,name),result);
    assert.throws(()=>patchPeer(result+'\n// drift',name),/Unexpected/);
  }
});
