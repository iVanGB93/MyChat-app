const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../modules/axonic-app-update/src/index.ts'), 'utf8');
function load(native) {
  const context = { exports: {}, require: () => ({ requireOptionalNativeModule: () => native }) };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports;
}
test('missing native module preserves store fallback', async () => {
  const module = load(null);
  assert.equal(module.supportsPlayUpdateFlow(), false);
  assert.equal(await module.startPlayUpdateAsync(), 'unavailable');
  assert.equal(await module.getPlayUpdateInfoAsync(), null);
  await assert.rejects(module.completePlayUpdateAsync(), /cannot install/);
});
test('existing check-only native builds remain compatible', async () => {
  const module = load({ getUpdateInfoAsync: async () => ({ availability: 'available' }) });
  assert.equal(module.supportsPlayUpdateFlow(), false);
  assert.equal(await module.startPlayUpdateAsync(), 'unavailable');
  assert.equal((await module.getPlayUpdateInfoAsync()).availability, 'available');
});
test('flow preserves cancellation and selects flexible vs immediate', async () => {
  const modes = []; let installed = false;
  const module = load({ startUpdateAsync: async (mode) => { modes.push(mode); return mode ? 'accepted' : 'cancelled'; }, completeUpdateAsync: async () => { installed = true; } });
  assert.equal(module.supportsPlayUpdateFlow(), true);
  assert.equal(await module.startPlayUpdateAsync(), 'cancelled');
  assert.equal(await module.startPlayUpdateAsync(true), 'accepted');
  assert.deepEqual(modes, [false, true]);
  assert.equal(installed, false);
  await module.completePlayUpdateAsync();
  assert.equal(installed, true);
});
test('native failures reach caller for fallback and retry feedback', async () => {
  const module = load({ startUpdateAsync: async () => { throw new Error('unavailable store'); }, completeUpdateAsync: async () => { throw new Error('not downloaded'); } });
  await assert.rejects(module.startPlayUpdateAsync(), /unavailable store/);
  await assert.rejects(module.completePlayUpdateAsync(), /not downloaded/);
});
