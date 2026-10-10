const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),ts=require('typescript');

// JS release flags cannot detect a native debug-only gate. Check the bridge too:
// all six mailbox operations must be available, while unsigned LAN stays guarded.
test('native release bridge exposes mailbox crypto but keeps unsigned LAN debug-only', () => {
 const native = fs.readFileSync('modules/axonic-nearby/android/src/main/java/expo/modules/axonicnearby/AxonicNearbyModule.kt', 'utf8');
 const mailbox = native.slice(native.indexOf('AsyncFunction("mailboxIdentity")'), native.indexOf('AsyncFunction("start")'));
 for (const method of ['Identity', 'Digest', 'Sign', 'Verify', 'Seal', 'Open']) {
  assert.ok(mailbox.includes(`AsyncFunction("mailbox${method}")`));
 }
 assert.doesNotMatch(mailbox, /developmentOnly|FLAG_DEBUGGABLE|BuildConfig\.DEBUG/);
 const lan = native.slice(native.indexOf('AsyncFunction("start")'), native.indexOf('AsyncFunction("stop")'));
 assert.match(lan, /check\(context\.applicationInfo\.flags and ApplicationInfo\.FLAG_DEBUGGABLE != 0\)/);
});

// Release flags in JavaScript cannot override a native debuggable-only check.
test('production axon entry points allow non-debug apps while retaining foreground or bounded wake checks',()=>{
 const source=fs.readFileSync('modules/axonic-nearby/android/src/main/java/expo/modules/axonicnearby/AxonicNearbyModule.kt','utf8');
 for(const name of ['axonLanStart','axonConnect','axonWssConnect']){
  const body=source.split('AsyncFunction("'+name+'")')[1].split(/\n    (?:AsyncFunction|Function)/)[0];
  assert.match(body,/check\(transportAllowed\(\)\)/);
  assert.doesNotMatch(body,/FLAG_DEBUGGABLE|BuildConfig\.DEBUG/);
 }
 assert.match(source,/foregroundGate.allowed\(SystemClock.elapsedRealtime\(\)\) \|\| protectedCall\(\) \|\| SystemClock.elapsedRealtime\(\) < wakeUntil/);
 assert.match(source,/require\(milliseconds in 0\.\.30000\)/);
 assert.match(source,/wakeTimer.schedule/);
 assert.match(source,/wakeTimer.shutdownNow/);
 const allowedHosts=source.match(/require\(host in setOf\(([^)]+)\) && account\.matches/);
 assert.ok(allowedHosts,'Native bootstrap destinations remain explicitly restricted');
 assert.deepEqual([...allowedHosts[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]),['143.198.121.2','secondneuron-production.up.railway.app']);
});
