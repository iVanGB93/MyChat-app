const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function setup(storage = new Map()) {
  const sandbox = { exports: {}, require: () => ({ default: {
    getItem: async (key) => storage.get(key) ?? null,
    setItem: async (key, value) => { storage.set(key, value); },
    removeItem: async (key) => { storage.delete(key); },
  } }) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/chat-drafts.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, sandbox);
  return sandbox.exports;
}
test('drafts persist across restarts and stay scoped to account and chat', async () => {
  const disk = new Map(); const service = setup(disk);
  await service.saveChatDraft(1, 'a', 'Hello\nnot finished ');
  await service.saveChatDraft(1, 'b', 'Different chat');
  await service.saveChatDraft(2, 'a', 'Different account');
  const restarted = setup(disk);
  assert.equal(await restarted.loadChatDraft(1, 'a'), 'Hello\nnot finished ');
  assert.equal(await restarted.loadChatDraft(1, 'b'), 'Different chat');
  assert.equal(await restarted.loadChatDraft(2, 'a'), 'Different account');
});
test('sending/clearing removes the stored draft and ordered writes cannot restore it', async () => {
  const disk = new Map(); const service = setup(disk);
  await Promise.all([service.saveChatDraft(1, 'a', 'first'), service.saveChatDraft(1, 'a', 'second'), service.saveChatDraft(1, 'a', '')]);
  assert.equal(disk.size, 0);
  assert.equal(await setup(disk).loadChatDraft(1, 'a'), '');
});
test('typing wins over a concurrent initial read', async () => {
  const service = setup(new Map([['@axonic_draft:1:a', 'old']]));
  const read = service.loadChatDraft(1, 'a');
  await service.saveChatDraft(1, 'a', 'new');
  assert.equal(await read, 'new');
});
