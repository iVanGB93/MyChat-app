const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/components/AppUpdateGate.tsx'), 'utf8');
function setup() {
  const state = { status: 0, watch: true, dismissed: true };
  const context = { useCallback: f => f, setInstallStatus: v => state.status = v,
    setWatchDownload: v => state.watch = v, setDismissed: v => state.dismissed = v };
  const start = source.indexOf('const applyInstallStatus =');
  const end = source.indexOf('const [nativeBusy', start);
  vm.runInNewContext(ts.transpileModule(source.slice(start, end) + '\nglobalThis.apply = applyInstallStatus;',
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return { state, apply: context.apply };
}
test('accepted download keeps being watched through unknown Play status', () => {
  const s = setup();
  s.apply(0); assert.equal(s.state.watch, true);
  s.apply(2); assert.equal(s.state.watch, true);
  s.apply(11); assert.equal(s.state.status, 11); assert.equal(s.state.watch, false);
});
test('failed or canceled downloads stop polling and allow retry', () => {
  for (const status of [5, 6]) {
    const s = setup(); s.apply(status);
    assert.equal(s.state.watch, false); assert.equal(s.state.dismissed, false);
  }
});
test('live events invalidate in-flight queries and subscription is cleaned up', () => {
  assert.match(source, /observePlayInstallStatus\(\(status\) =>[\s\S]*installRevision.current \+= 1;[\s\S]*applyInstallStatus\(status\)/);
  assert.match(source, /revision !== installRevision.current/);
  assert.match(source, /installSubscription\?\.remove\(\)/);
  assert.match(source, /if \(installStatus === 11\) return/);
});
