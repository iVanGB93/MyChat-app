const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/utils/sticker-grid.ts'), 'utf8');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
test('sticker grid fits exactly three columns on small phones, tablets and landscape', () => {
  for (const width of [280, 320, 360, 411, 768, 1024]) {
    const cell = context.exports.stickerGridCellWidth(width);
    assert.ok(cell * 3 + 24 <= width - 32);
    assert.ok(cell * 4 + 36 > width - 32);
  }
});

test('sticker picker animates the grid and preview without selection gating', () => {
  const picker = fs.readFileSync(path.join(__dirname, '../src/components/chat/sticker-picker.tsx'), 'utf8');
  const artwork = fs.readFileSync(path.join(__dirname, '../src/components/chat/sticker-art.tsx'), 'utf8');
  assert.match(picker, /size=\{Math\.min\(110, cellWidth\)\} animate loop/);
  assert.match(picker, /size=\{140\} animate loop/);
  assert.match(artwork, /loop = false/);
  assert.match(artwork, /iterations: loop \? -1 : 3/);
  assert.match(artwork, /if \(!animate \|\| reduceMotion \|\| !active \|\| !focused\) return/);
  assert.match(artwork, /animation\.stop\(\)/);
});

test('chat stickers loop and saved collections are separate from creation', () => {
  const bubble = fs.readFileSync(path.join(__dirname, '../src/components/chat/MessageBubble.tsx'), 'utf8');
  const picker = fs.readFileSync(path.join(__dirname, '../src/components/chat/sticker-picker.tsx'), 'utf8');
  const studio = fs.readFileSync(path.join(__dirname, '../src/components/chat/sticker-studio.tsx'), 'utf8');
  assert.match(bubble, /<StickerArt sticker=\{sticker\} animate loop/);
  assert.match(picker, /\['All', 'Axonic', 'Recent', 'Favorites', 'Create'\]/);
  assert.doesNotMatch(studio, /items\.map|My stickers/);
  assert.match(picker, /await onSendImported\(selectedCustom\);[\s\S]*await markImportedStickerSent/);
});
