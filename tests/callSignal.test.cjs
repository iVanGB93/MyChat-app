const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,
  '../src/services/call-signal.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const { scopeCallSignal, readCallSignal } = context.exports;

test('call scope survives the deployed relay and is removed before native WebRTC', () => {
  const raw = { type: 'offer', sdp: 'test-sdp' };
  const wire = JSON.parse(JSON.stringify(scopeCallSignal(raw, 'call-2')));
  assert.equal(wire.axonic_call_id, 'call-2');
  assert.equal(JSON.stringify(readCallSignal(wire, 'call-2')), JSON.stringify(raw));
  assert.equal(raw.axonic_call_id, undefined);
});
test('delayed SDP and ICE from a previous call are rejected', () => {
  for (const data of [{ type: 'answer', sdp: 'old' }, { candidate: 'old' }]) {
    assert.equal(readCallSignal(scopeCallSignal(data, 'old-call'), 'new-call'), null);
  }
});
test('older clients remain compatible; malformed payloads are ignored', () => {
  assert.equal(readCallSignal({ candidate: 'legacy' }, 'call-2').candidate, 'legacy');
  for (const data of [null, undefined, [], 2, 'invalid']) {
    assert.equal(readCallSignal(data, 'call-2'), null);
  }
});
