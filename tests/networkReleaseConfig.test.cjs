const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),ts=require('typescript');

// Retired numeric-user mailbox and unsigned room transport have no mobile bridge.
test('native bridge retains identity primitives and removes retired mailbox and room entry points',()=>{
 const native=fs.readFileSync('modules/axonic-nearby/android/src/main/java/expo/modules/axonicnearby/AxonicNearbyModule.kt','utf8');
 for(const name of ['identityScrypt','identityRandomBytes','axonLanStart','axonWssConnect','attachmentFileSha256'])assert(native.includes(`AsyncFunction("${name}")`));
 assert.doesNotMatch(native,/MailboxCrypto|AsyncFunction\("(?:mailbox\w+|start|stop)"\)|Function\("send"\)|onNearby|class Lane/);
});

// Release flags in JavaScript cannot override a native debuggable-only check.
test('production axon entry points allow non-debug apps while retaining foreground or bounded wake checks',()=>{
 const source=fs.readFileSync('modules/axonic-nearby/android/src/main/java/expo/modules/axonicnearby/AxonicNearbyModule.kt','utf8');
 for(const name of ['axonLanStart','axonConnect','axonWssConnect']){
  const body=source.split('AsyncFunction("'+name+'")')[1].split(/\n    (?:AsyncFunction|Function)/)[0];
  assert.match(body,/check\(transportAllowed\(\)\)/);
  assert.doesNotMatch(body,/FLAG_DEBUGGABLE|BuildConfig\.DEBUG/);
 }
 assert.match(source,/foregroundGate.allowed\(SystemClock.elapsedRealtime\(\)\) \|\| AttachmentUploadJob.transportAllowed\(\) \|\| MessageRecoveryJob.transportAllowed\(\) \|\| protectedCall\(\) \|\| SystemClock.elapsedRealtime\(\) < wakeUntil/);
 assert.match(source,/require\(milliseconds in 0\.\.30000\)/);
 assert.match(source,/wakeTimer.schedule/);
 assert.match(source,/wakeTimer.shutdownNow/);
 const wss=source.split('AsyncFunction("axonWssConnect")')[1].split(/\n    (?:AsyncFunction|Function)/)[0];
 assert.match(wss,/require\(host\.length <= 253 && host\.split\('\.'\)\.all/);
 assert.match(wss,/account\.matches\(Regex\("axonic:1:/);
 const sockets=fs.readFileSync('modules/axonic-nearby/android/src/main/java/expo/modules/axonicnearby/AxonSockets.kt','utf8');
 assert.match(sockets,/InetSocketAddress\(host, 443\)/);
 assert.match(sockets,/endpointIdentificationAlgorithm = "HTTPS"/);
 assert.match(sockets,/tls\.startHandshake\(\)/);
});
