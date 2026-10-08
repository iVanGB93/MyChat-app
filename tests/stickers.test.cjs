const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/stickers.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function fixture(disk = new Map(), failWrite = false) {
  const context = { exports: {}, require: (name) => {
    assert.equal(name, '@react-native-async-storage/async-storage');
    return { default: { getItem: async (key) => disk.get(key) ?? null, setItem: async (key, value) => {
      if (failWrite) throw new Error('disk full');
      disk.set(key, value);
    } } };
  } };
  vm.runInNewContext(compiled, context);
  return { ...context.exports, disk };
}
test('every bundled sticker roundtrips through the existing text transport', () => {
  const s = fixture();
  for (const sticker of s.STICKERS) {
    const content = s.stickerMessage(sticker);
    assert.equal(s.parseSticker(content).id, sticker.id);
    assert.ok(content.includes(sticker.label));
    assert.ok(content.length < 140);
    assert.equal(s.parseSticker(`Quoted: ${content}`), undefined);
    assert.equal(s.parseSticker(content.replace(':v1:', ':v2:')), undefined);
  }
  assert.equal(s.parseSticker('hello'), undefined);
});
test('recent is ordered, deduplicated, persistent and account scoped', async () => {
  const s = fixture();
  await Promise.all(['hello', 'love', 'hello'].map((id) => s.updateStickerPreferences(1, id, 'recent')));
  const restarted = fixture(s.disk);
  assert.equal((await restarted.loadStickerPreferences(1)).recent.join(','), 'hello,love');
  assert.equal((await restarted.loadStickerPreferences(2)).recent.length, 0);
});
test('favorites toggle independently from recent without losing concurrent changes', async () => {
  const s = fixture();
  await Promise.all([s.updateStickerPreferences(1, 'hello', 'favorite'), s.updateStickerPreferences(1, 'love', 'favorite')]);
  await s.updateStickerPreferences(1, 'hello', 'favorite');
  const prefs = await s.loadStickerPreferences(1);
  assert.equal(prefs.favorites.join(','), 'love');
  assert.equal(prefs.recent.length, 0);
});
test('corrupt preferences and removed sticker ids do not break picker', async () => {
  const s = fixture(new Map([['@axonic_stickers:v1:1', '{invalid']]));
  assert.equal((await s.loadStickerPreferences(1)).recent.length, 0);
  s.disk.set('@axonic_stickers:v1:1', JSON.stringify({ recent: ['hello', 'bad', 'hello', 5], favorites: null }));
  assert.equal((await s.loadStickerPreferences(1)).recent.join(','), 'hello');
  await assert.rejects(s.updateStickerPreferences(1, 'unknown', 'recent'));
  await s.updateStickerPreferences(1, 'love', 'favorite');
});
test('storage failure is surfaced rather than pretending favorite was saved', async () => {
  const s = fixture(new Map(), true);
  await assert.rejects(s.updateStickerPreferences(1, 'love', 'favorite'), /disk full/);
});

test('root identities keep sticker preferences separate from one another and legacy accounts',async()=>{
 const s=fixture(),a='axonic:1:'+'a'.repeat(64),b='axonic:1:'+'b'.repeat(64);
 await s.updateStickerPreferences(a,'hello','favorite');await s.updateStickerPreferences(b,'love','recent');await s.updateStickerPreferences(1,'party','favorite');
 assert.equal((await s.loadStickerPreferences(a)).favorites.join(','),'hello');assert.equal((await s.loadStickerPreferences(b)).favorites.length,0);assert.equal((await s.loadStickerPreferences(1)).favorites.join(','),'party');
 assert.match(s.stickerOwnerKey(a),/^root-[a-f0-9]{64}$/);
 for(const bad of ['../1','1','axonic:1:../../',0,-1,NaN])assert.throws(()=>s.stickerOwnerKey(bad));
});
