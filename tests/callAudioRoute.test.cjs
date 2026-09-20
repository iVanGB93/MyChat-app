const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(native) {
  const s = { exports: {}, require: () => ({ requireOptionalNativeModule: () => native }) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/call-audio-route.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, s);
  return s.exports;
}
test('speaker requests and restoration stay ordered across delayed native calls', async () => {
  const actions = [];
  const audio = load({ setCallSpeaker: async (value) => { await Promise.resolve(); actions.push(value); return value; }, restoreCallAudio: async () => { actions.push('restore'); } });
  const first = audio.setCallSpeaker(true);
  audio.restoreCallAudio();
  const next = audio.setCallSpeaker(false);
  assert.equal(await first, true);
  assert.equal(await next, false);
  assert.deepEqual(actions, [true, 'restore', false]);
});
test('old development clients get an explanatory error instead of a fake toggle', async () => {
  const audio = load({});
  await assert.rejects(audio.setCallSpeaker(true), /updated Android build/);
  audio.restoreCallAudio();
});
