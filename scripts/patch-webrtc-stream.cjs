// Applied after (and stripped before) the pinned identity patch. No bypass of
// upstream hashes: every extension edit must match exactly on subsequent runs.
const wrapperFields=`    // Axonic stream admission v1
    private final AxonicStreamDataGuard axonicStream = new AxonicStreamDataGuard();
    synchronized boolean axonicStreamAuthorize(long bytes) { return axonicIdentity && "axonic-stream-v1".equals(mDataChannel.label()) && axonicStream.authorize(bytes); }
    synchronized boolean axonicStreamConsume(long offset) { return axonicIdentity && "axonic-stream-v1".equals(mDataChannel.label()) && axonicStream.consume(offset); }
`;
const streamHook=`        // Axonic stream admission v1
        if (axonicIdentity && "axonic-stream-v1".equals(mDataChannel.label())) {
            synchronized (this) {
                if (axonicCloseScheduled) return;
                if (!axonicStream.receive(buffer.data, buffer.binary)) {
                    axonicCloseScheduled = true;
                    ThreadUtils.runOnExecutor(() -> mDataChannel.close());
                    return;
                }
                // Copy only the admitted slice, never the entire backing array.
                byte[] admitted = new byte[buffer.data.remaining()];
                buffer.data.asReadOnlyBuffer().get(admitted);
                WritableMap event = Arguments.createMap();
                event.putString("reactTag", reactTag);
                event.putInt("peerConnectionId", peerConnectionId);
                event.putString("type", buffer.binary ? "binary" : "text");
                event.putString("data", buffer.binary ? Base64.encodeToString(admitted, Base64.NO_WRAP) : new String(admitted, StandardCharsets.UTF_8));
                webRTCModule.sendEvent("dataChannelReceiveMessage", event);
                return;
            }
        }
`;
const policy=`axonicIdentityGuard && (!"axonic-identity-v1".equals(dataChannel.label()) || !dataChannels.isEmpty())`;
const policy2=`axonicIdentityGuard && !("axonic-identity-v1".equals(dataChannel.label()) && dataChannels.isEmpty()
                || "axonic-stream-v1".equals(dataChannel.label()) && axonicStreamPeerAuthenticated && dataChannels.size() == 1)`;
const edits={
 'DataChannelWrapper.java':[
  ['    private AxonicIdentityDataGuard axonicGuard;',wrapperFields+'    private AxonicIdentityDataGuard axonicGuard;'],
  ['    public void onMessage(DataChannel.Buffer buffer) {\n','    public void onMessage(DataChannel.Buffer buffer) {\n'+streamHook],
 ],
 'PeerConnectionObserver.java':[
  ['    boolean axonicIdentityGuard;','    boolean axonicIdentityGuard;\n    // Axonic stream admission v1\n    private boolean axonicStreamPeerAuthenticated;'],
  [policy,policy2],
  ['        if (axonicIdentityGuard && channel != null) channel.axonicAuthenticated();',`        if (axonicIdentityGuard && channel != null && "axonic-identity-v1".equals(channel.getDataChannel().label())) {
            channel.axonicAuthenticated(); axonicStreamPeerAuthenticated = true;
        }`],
  ['    void dataChannelSend(String reactTag, String data, String type) {',`    // Axonic stream admission v1
    boolean axonicStreamCredit(String reactTag, long value, boolean authorize) {
        DataChannelWrapper channel = dataChannels.get(reactTag);
        return axonicIdentityGuard && axonicStreamPeerAuthenticated && channel != null
            && (authorize ? channel.axonicStreamAuthorize(value) : channel.axonicStreamConsume(value));
    }

    void dataChannelSend(String reactTag, String data, String type) {`],
 ],
 'WebRTCModule.java':[
  ['    public int axonicIdentityGuardVersion() { return 1; }',`    public int axonicIdentityGuardVersion() { return 1; }

    // Axonic stream admission v1
    @ReactMethod(isBlockingSynchronousMethod = true)
    public int axonicStreamGuardVersion() { return 1; }

    @ReactMethod
    public void axonicStreamCredit(int peerConnectionId, String reactTag, double value, boolean authorize, com.facebook.react.bridge.Promise promise) {
        if (!Double.isFinite(value) || value < 0 || value != Math.floor(value) || value > 250L * 1024 * 1024) {
            promise.resolve(false); return;
        }
        ThreadUtils.runOnExecutor(() -> {
            PeerConnectionObserver observer = mPeerConnectionObservers.get(peerConnectionId);
            promise.resolve(observer != null && observer.axonicStreamCredit(reactTag, (long)value, authorize));
        });
    }`],
 ],
};
function apply(source,name){
 for(const [old,next] of edits[name]??[]){
  if(!source.includes(old))throw Error('Stream patch anchor missing: '+name);
  source=source.split(old).join(next);
 }
 return source;
}
function strip(source,name){
 if(!source.includes('// Axonic stream admission v1'))return source;
 let original=source;
 for(const [old,next] of [...edits[name]??[]].reverse())original=original.split(next).join(old);
 if(original.includes('// Axonic stream admission v1')||apply(original,name)!==source)throw Error('Partial native stream admission patch');
 return original;
}
module.exports={apply,strip};
