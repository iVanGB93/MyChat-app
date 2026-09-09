const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/contact-nicknames.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(disk = new Map()) {
  const modules = {
    zustand: require('zustand'),
    '@react-native-async-storage/async-storage': { default: {
      getItem: async (key) => disk.get(key) ?? null,
      setItem: async (key, value) => disk.set(key, value),
    } },
  };
  const context = { exports: {}, require: (name) => { assert.ok(name in modules, `unexpected dependency: ${name}`); return modules[name]; } };
  vm.runInNewContext(compiled, context);
  return { ...context.exports, disk };
}

test('nickname persists locally across restart and follows each display format', async () => {
  const app = fixture();
  await app.saveContactNickname(1, 2, ' dad ');
  const restarted = fixture(app.disk);
  const names = await restarted.loadContactNicknames(1);
  assert.equal(restarted.resolveContactName(names, 2, 'Jhon', 'Jhon'), 'dad - Jhon');
  assert.equal(restarted.resolveContactName(names, 2, 'Jhon'), 'dad');
  assert.equal(restarted.resolveContactName(names, 3, 'Other'), 'Other');
});

test('same contact can have different private names in different accounts', async () => {
  const app = fixture();
  await app.saveContactNickname(1, 2, 'Dad');
  await app.saveContactNickname(3, 2, 'Brother');
  assert.equal(app.namesForOwner(1)[2], 'Dad');
  assert.equal(app.namesForOwner(3)[2], 'Brother');
  assert.equal(app.namesForOwner(undefined)[2], undefined);
});

test('simultaneous edits preserve both contacts and clearing restores profile name', async () => {
  const app = fixture();
  await Promise.all([app.saveContactNickname(1, 2, 'Dad'), app.saveContactNickname(1, 3, 'Mom')]);
  await app.saveContactNickname(1, 2, '  ');
  assert.equal(app.resolveContactName(app.namesForOwner(1), 2, 'Jhon', 'Jhon'), 'Jhon');
  assert.equal(app.namesForOwner(1)[3], 'Mom');
});

test('headless notifications use only the signed-in account nickname', async () => {
  const app = fixture();
  await app.saveContactNickname(1, 2, 'Dad');
  app.disk.set('@axonic_user_cache', JSON.stringify({ id: 1 }));
  assert.equal(await app.notificationContactName(2, 'Jhon'), 'Dad');
  app.disk.set('@axonic_user_cache', JSON.stringify({ id: 3 }));
  assert.equal(await app.notificationContactName(2, 'Jhon'), 'Jhon');
});
