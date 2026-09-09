const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
function moduleFrom(file, modules = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services', file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const context = { exports: {}, Uint8Array, DataView, require: (name) => { assert.ok(name in modules, name); return modules[name]; } };
  vm.runInNewContext(output, context);
  return context.exports;
}
const format = moduleFrom('sticker-file-format.ts');
function png(width = 512, animation = false) {
  const chunk = (name, data) => {
    const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length); b.write(name, 4); data.copy(b, 8); return b;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(512, 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...(animation ? [chunk('acTL', Buffer.alloc(8))] : []), chunk('IEND', Buffer.alloc(0))]);
}
function webp(kind) {
  const b = Buffer.alloc(24); b.write('RIFF'); b.writeUInt32LE(16, 4); b.write('WEBP', 8); b.write(kind, 12); b.writeUInt32LE(4, 16); return b;
}
test('file validation checks actual PNG/WebP containers, not extensions', () => {
  assert.equal(format.validateStickerFile(png()), 'png');
  assert.equal(format.validateStickerFile(webp('VP8L')), 'webp');
  assert.throws(() => format.validateStickerFile(Buffer.from('fake.png')), /PNG or WebP/);
  assert.throws(() => format.validateStickerFile(png().subarray(0, 40)), /Incomplete/);
});
test('animated, oversized and excessive-dimension stickers are rejected', () => {
  assert.throws(() => format.validateStickerFile(png(512, true)), /Animated/);
  assert.throws(() => format.validateStickerFile(webp('ANIM')), /Animated/);
  assert.throws(() => format.validateStickerFile(png(4096)), /dimensions/);
  assert.throws(() => format.validateStickerFile(new Uint8Array(format.MAX_STICKER_BYTES + 1)), /2 MB/);
});
function fixture() {
  const disk = new Map(), files = new Map([['file:///input', png()]]);
  let failWrite = false;
  class Directory {
    constructor(...parts) { this.uri = parts.map((p) => p.uri ?? p).join('/'); }
    get exists() { return true; } create() {}
  }
  class File extends Directory {
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.length || 0; }
    get md5() { return 'a'.repeat(32); }
    async bytes() { return files.get(this.uri); }
    copy(dest) { files.set(dest.uri, files.get(this.uri)); }
    delete() { files.delete(this.uri); }
  }
  const api = moduleFrom('imported-stickers.ts', {
    '@react-native-async-storage/async-storage': { default: { getItem: async (k) => disk.get(k), setItem: async (k, v) => { if (failWrite) throw new Error('disk full'); disk.set(k, v); } } },
    'expo-file-system': { Directory, File, Paths: { document: 'file:///documents' } },
    'react-native': { Image: { getSize: async () => ({ width: 512, height: 512 }) } },
    'expo-image-manipulator': { SaveFormat: { PNG: 'png' }, manipulateAsync: async (_, actions, options) => {
      assert.equal(options.format, 'png'); files.set('file:///normalized', png()); return { uri: 'file:///normalized' };
    } },
    './sticker-file-format': format,
  });
  return { api, files, disk, fail: () => { failWrite = true; } };
}
test('imports are durable, deduplicated, and account scoped', async () => {
  const { api, files } = fixture();
  await api.importSticker(1, 'file:///input', 'hello.webp');
  const rows = await api.importSticker(1, 'file:///input', 'same.webp');
  assert.equal(rows.length, 1);
  assert.ok(files.has(api.importedStickerUri(1, rows[0])));
  assert.equal((await api.loadImportedStickers(2)).length, 0);
  assert.ok(!files.has('file:///normalized'));
  assert.ok(files.has('file:///input'));
  await api.removeImportedSticker(1, rows[0]);
  assert.ok(!files.has(api.importedStickerUri(1, rows[0])));
});
test('failed index write rolls back only the newly imported copy', async () => {
  const f = fixture(); f.fail();
  await assert.rejects(f.api.importSticker(1, 'file:///input', 'hello'), /disk full/);
  assert.equal(f.files.size, 1);
  assert.ok(f.files.has('file:///input'));
});
test('failed removal index write leaves existing sticker intact', async () => {
  const f = fixture(); const rows = await f.api.importSticker(1, 'file:///input', 'hello'); f.fail();
  await assert.rejects(f.api.removeImportedSticker(1, rows[0]), /disk full/);
  assert.ok(f.files.has(f.api.importedStickerUri(1, rows[0])));
});
