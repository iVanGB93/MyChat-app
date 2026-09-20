const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { IMPORTED_STICKER_CONTENT } = require('../src/services/sticker-file-format.ts');
const mocks = {
  react: { useEffect: () => {}, useState: (value) => [value, () => {}] },
  'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
  'react-native': { Text: 'Text' }, 'expo-image': { Image: 'Image' },
  '../../services/stickers': { parseSticker: (value) => value === '[axonic-sticker:v1:love]' ? { label: 'Love' } : undefined },
  '../../services/sticker-file-format': { IMPORTED_STICKER_CONTENT },
  '../../services/localMessageStore': { getMessagesByIds: async () => [] },
  './sticker-art': { default: 'StickerArt' },
};
const sandbox = { exports: {}, require: (name) => { assert.ok(mocks[name], name); return mocks[name]; } };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/chat/reply-content.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText, sandbox);
const render = sandbox.exports.default;

test('Axonic sticker replies render compact animated art instead of the marker', () => {
  const result = render({ id: '1', type: 'text', content: '[axonic-sticker:v1:love]' });
  assert.equal(result.type, 'StickerArt'); assert.equal(result.props.size, 48);
  assert.equal(result.props.animate, true); assert.equal(result.props.loop, true);
});
test('custom sticker reply previews use autoplay and a safe missing-media fallback', () => {
  const props = { id: '2', type: 'image', content: IMPORTED_STICKER_CONTENT };
  const result = render({ ...props, uri: 'content://media/test' });
  assert.equal(result.type, 'Image'); assert.equal(result.props.autoplay, true);
  assert.equal(result.props.contentFit, 'contain');
  assert.equal(render(props).props.children, 'Sticker unavailable');
});
test('ordinary text replies remain unchanged', () => {
  assert.equal(render({ id: '3', type: 'text', content: 'Hello' }).props.children, 'Hello');
});
