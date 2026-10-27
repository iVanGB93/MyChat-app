// Narrow extension of the pinned stream admission patch. JS additionally binds
// the channel to the currently accepted call ID before attaching any listener.
const old='|| "axonic-stream-v1".equals(dataChannel.label()) && axonicStreamPeerAuthenticated && dataChannels.size() == 1)';
const next='|| axonicStreamPeerAuthenticated && dataChannels.size() < 3\n                && ("axonic-stream-v1".equals(dataChannel.label()) || dataChannel.label().matches("axonic-call-v1:[0-9a-f]{64}")))';
exports.apply=(source,name)=>{if(name!=='PeerConnectionObserver.java')return source;if(!source.includes(old))throw Error('Shared call admission anchor missing');return source.replace(old,next);};
exports.strip=(source,name)=>name==='PeerConnectionObserver.java'?source.replace(next,old):source;
