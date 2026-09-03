const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(
  path.join(__dirname, '../src/services/media-export-service.ts'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(compiled, {
  exports: exportsObject,
  module: { exports: exportsObject },
  require(name) {
    if (name === '@react-native-async-storage/async-storage') return { default: {} };
    if (name === 'react-native') return { Platform: { OS: 'android' } };
    if (name === 'expo-file-system') return { File: class {}, Paths: { cache: { uri: '' }, document: { uri: '' } } };
    if (name === 'expo-file-system/legacy') return {};
    if (name === './localMessageStore') return {};
    throw new Error(`Unexpected import: ${name}`);
  },
  encodeURIComponent,
  decodeURIComponent,
  console,
});

const { safeExportFileName, parseDeviceMediaFileName } = exportsObject;

test('public media filename preserves the complete message UUID', () => {
  const messageId = '411bdca0-3fca-44e3-b608-a7967bf61fe8';
  const fileName = safeExportFileName({
    messageId,
    mediaType: 'document',
    fileName: '📄 family budget.pdf',
    mime: 'application/pdf',
  });
  assert.equal(fileName, `AXN_${messageId}__family budget.pdf`);
  assert.equal(parseDeviceMediaFileName(fileName), messageId);
});

test('filename identity safely round-trips reserved characters', () => {
  const messageId = 'legacy:room/message 27';
  const fileName = safeExportFileName({ messageId, mediaType: 'voice', fileName: 'Voice message' });
  assert.match(fileName, /^AXN_legacy%3Aroom%2Fmessage%2027__/);
  assert.equal(parseDeviceMediaFileName(fileName), messageId);
});

test('unrelated Gallery and Downloads files are ignored during recovery', () => {
  assert.equal(parseDeviceMediaFileName('vacation.jpg'), null);
  assert.equal(parseDeviceMediaFileName('AXN_not-complete.jpg'), null);
});

test('first Gallery save creates the Axonic album directly without an item-specific move prompt', () => {
  assert.match(
    source,
    /createAlbumAsync\(\s*ALBUM_NAME,\s*undefined,\s*true,\s*staging\.uri,?\s*\)/,
  );
  assert.doesNotMatch(source, /createAlbumAsync\(\s*ALBUM_NAME,\s*asset,\s*false/);
});
