const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {} };
const source = fs.readFileSync(path.join(__dirname, '../src/utils/chat-preview-text.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { chatPreviewText } = context.exports;

test('Axonic stickers retain only the readable first part', () => {
  assert.equal(chatPreviewText('🩵 Love it [axonic-sticker:v1:love]'), '🩵 Love it');
  assert.equal(chatPreviewText('👋 Hello! [axonic-sticker:v1:hello]'), '👋 Hello!');
  assert.equal(chatPreviewText('[axonic-sticker:v1:love]'), 'Sticker');
});
test('custom and imported sticker previews use a simple label', () => {
  assert.equal(chatPreviewText('Sticker [axonic-sticker:import:v1]'), 'Sticker');
});
test('ordinary text and media labels stay unchanged', () => {
  for (const content of ['', 'Hello!', '📷 Photo', '📹 Video', 'Sticker', 'Look [axonic-sticker:v1:love] here']) {
    assert.equal(chatPreviewText(content), content);
  }
});
