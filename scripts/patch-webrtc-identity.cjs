const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const pkg = path.join(root, 'node_modules/react-native-webrtc');
const dir = path.join(pkg, 'android/src/main/java/com/oney/WebRTCModule');
const file = path.join(dir, 'DataChannelWrapper.java');
const marker = '    // Axonic identity bridge guard v1\n';
const fields = marker + '    private AxonicIdentityDataGuard axonicGuard;\n    private boolean axonicCloseScheduled;\n    private final boolean axonicIdentity;\n';
const authenticatedMethod = `    synchronized void axonicAuthenticated() {
        if (!axonicIdentity || axonicCloseScheduled) return;
        if (axonicGuard == null) axonicGuard = new AxonicIdentityDataGuard();
        axonicGuard.authenticated();
    }
`;
const hook = `        // Axonic identity bridge guard v1
        if (axonicIdentity || "axonic-identity-v1".equals(mDataChannel.label())) {
            synchronized (this) {
                if (axonicCloseScheduled) return;
                if (axonicGuard == null) axonicGuard = new AxonicIdentityDataGuard();
                String text = axonicGuard.receive(buffer.data, buffer.binary, android.os.SystemClock.elapsedRealtime());
                if (text == null) {
                    axonicCloseScheduled = true;
                    ThreadUtils.runOnExecutor(() -> mDataChannel.close());
                    return;
                }
                WritableMap event = Arguments.createMap();
                event.putString("reactTag", reactTag);
                event.putInt("peerConnectionId", peerConnectionId);
                event.putString("type", "text");
                event.putString("data", text);
                webRTCModule.sendEvent("dataChannelReceiveMessage", event);
                return;
            }
        }
`;
function patch(source, version) {
    if (version !== '124.0.7') throw Error('Review the identity bridge guard for this react-native-webrtc version');
    const normalized = source.replace(/\r\n/g, '\n');
    const original = normalized.replace(authenticatedMethod, '').replace(fields, '').replace(hook, '')
        .replace('DataChannel dataChannel, boolean axonicIdentity)', 'DataChannel dataChannel)')
        .replace('        this.axonicIdentity = axonicIdentity;\n', '');
    if (crypto.createHash('sha256').update(original).digest('hex') !== '701dc0f36d963dfc80ca939ead7ce098936017fe4651ee33d6949cd8d7ae4ed8') {
        throw Error('Unexpected WebRTC Android wrapper source; review the identity guard before building');
    }
    const expected = original.replace('DataChannel dataChannel)', 'DataChannel dataChannel, boolean axonicIdentity)')
        .replace('        mDataChannel = dataChannel;', '        mDataChannel = dataChannel;\n        this.axonicIdentity = axonicIdentity;')
        .replace('class DataChannelWrapper implements DataChannel.Observer {\n',
        'class DataChannelWrapper implements DataChannel.Observer {\n' + fields + authenticatedMethod)
        .replace('    public void onMessage(DataChannel.Buffer buffer) {\n',
            '    public void onMessage(DataChannel.Buffer buffer) {\n' + hook);
    if (normalized !== original && normalized !== expected && normalized !== expected.replace(authenticatedMethod,'')) throw Error('Partial identity guard patch; review before building');
    return expected;
}
const observerGuard = `        // Axonic: reject unexpected/extra channels before registering a bridge observer.
        if (axonicIdentityGuard && (!"axonic-identity-v1".equals(dataChannel.label()) || !dataChannels.isEmpty())) {
            dataChannel.close();
            return;
        }
`;
const edits = {
    'PeerConnectionObserver.java': {
        hash: 'be058064b217928421d89abc3d2a98b2ef3ef1bd3dd18e3fb89caa7bc8e44cf4',
        changes: [
            ['    PeerConnectionObserver(WebRTCModule webRTCModule, int id) {', '    boolean axonicIdentityGuard;\n\n    PeerConnectionObserver(WebRTCModule webRTCModule, int id) {'],
            ['new DataChannelWrapper(webRTCModule, id, reactTag, dataChannel);', 'new DataChannelWrapper(webRTCModule, id, reactTag, dataChannel, axonicIdentityGuard);'],
            ['            final String reactTag = UUID.randomUUID().toString();\n            DataChannelWrapper', observerGuard+'            final String reactTag = UUID.randomUUID().toString();\n            DataChannelWrapper'],
            ['            dataChannel.registerObserver(dcw);', '            if (!axonicIdentityGuard) dataChannel.registerObserver(dcw);'],
            ['            webRTCModule.sendEvent("peerConnectionDidOpenDataChannel", params);', '            webRTCModule.sendEvent("peerConnectionDidOpenDataChannel", params);\n            // Registration can synchronously drain received frames. Announce the channel first.\n            if (axonicIdentityGuard) dataChannel.registerObserver(dcw);'],
            ['    void dataChannelSend(String reactTag, String data, String type) {', '    void axonicAuthenticated(String reactTag) {\n        DataChannelWrapper channel = dataChannels.get(reactTag);\n        if (axonicIdentityGuard && channel != null) channel.axonicAuthenticated();\n    }\n\n    void dataChannelSend(String reactTag, String data, String type) {'],
        ],
    },
    'WebRTCModule.java': {
        hash: 'c6c9eaf4d0cbce0f47b661792fd8aa457e0e157a8d573071935bd3746c75f91c',
        changes: [
            ['    public boolean peerConnectionInit(ReadableMap configuration, int id) {', '    public int axonicIdentityGuardVersion() { return 1; }\n\n    @ReactMethod(isBlockingSynchronousMethod = true)\n    public boolean peerConnectionInit(ReadableMap configuration, int id) {'],
            ['                        PeerConnectionObserver observer = new PeerConnectionObserver(this, id);', '                        PeerConnectionObserver observer = new PeerConnectionObserver(this, id);\n                        observer.axonicIdentityGuard = configuration != null && configuration.hasKey("axonicIdentityGuard") && configuration.getBoolean("axonicIdentityGuard");'],
            ['    public void dataChannelSend(int peerConnectionId, String reactTag, String data, String type) {', '    public void axonicIdentityAuthenticated(int peerConnectionId, String reactTag) {\n        ThreadUtils.runOnExecutor(() -> {\n            PeerConnectionObserver observer = mPeerConnectionObservers.get(peerConnectionId);\n            if (observer != null) observer.axonicAuthenticated(reactTag);\n        });\n    }\n\n    @ReactMethod\n    public void dataChannelSend(int peerConnectionId, String reactTag, String data, String type) {'],
        ],
    },
};
function patchPeer(source, name) {
    const spec=edits[name]; if(!spec)throw Error('Unknown native source');
    const normalized=source.replace(/\r\n/g,'\n');let original=normalized;
    for(const [old,next] of [...spec.changes].reverse())original=original.split(next).join(old);
    if(crypto.createHash('sha256').update(original).digest('hex')!==spec.hash)throw Error('Unexpected WebRTC peer source: '+name);
    let expected=original;for(const [old,next] of spec.changes)expected=expected.split(old).join(next);
    let previous=original;const supported=[original,expected];
    for(let i=0;i<spec.changes.length;i++){const [old,next]=spec.changes[i];previous=previous.split(old).join(next);if((name==='PeerConnectionObserver.java'&&[2,4].includes(i))||(name==='WebRTCModule.java'&&i===1))supported.push(previous);}
    if(!supported.includes(normalized))throw Error('Partial native peer guard patch');
    return expected;
}
if (require.main === module) {
    const source = fs.readFileSync(file, 'utf8');
    const patched = patch(source, JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version);
    const guard = fs.readFileSync(path.join(__dirname, 'native/AxonicIdentityDataGuard.java'), 'utf8');
    const target = path.join(dir, 'AxonicIdentityDataGuard.java');
    // Validate every source before any write.
    const peers=Object.keys(edits).map(name=>({name,source:patchPeer(fs.readFileSync(path.join(dir,name),'utf8'),name)}));
    if (source !== patched) fs.writeFileSync(file, patched);
    for(const peer of peers)if(fs.readFileSync(path.join(dir,peer.name),'utf8')!==peer.source)fs.writeFileSync(path.join(dir,peer.name),peer.source);
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== guard) fs.writeFileSync(target, guard);
    console.log('Android identity channel receive guard applied');
}
module.exports = { patch, patchPeer };
