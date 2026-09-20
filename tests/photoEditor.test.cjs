const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/components/chat/photo-editor.tsx'), 'utf8');
function setup(preserveTransparency = false) {
  const calls = [], saved = [], dragging = [], effects = [], canvases = [];
  let stateIndex = 0;
  const initial = [{ uri: 'file:///working-copy.jpg', width: 800, height: 600 }, false, true];
  const mocks = {
    react: { useCallback: (fn) => fn, useEffect: (fn) => effects.push(fn), useRef: (value) => ({ current: value }), useState: (value) => [stateIndex < initial.length ? initial[stateIndex++] : (stateIndex++, value), () => {}] },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    'react-native': { ActivityIndicator: 'Spinner', Alert: { alert: (...args) => calls.push(args) }, Modal: 'Modal', ScrollView: 'Scroll', Text: 'Text', TextInput: 'Input', TouchableOpacity: 'Button', View: 'View', useWindowDimensions: () => ({ width: 400, height: 800 }) },
    'react-native-svg': { default: 'Svg', Image: 'Image', Path: 'Path', Text: 'SvgText' },
    'expo-image-manipulator': { SaveFormat: { JPEG: 'jpeg', PNG: 'png' }, manipulateAsync: async (uri, actions, options) => {
      calls.push({ uri, actions, options }); return { uri: 'file:///edited-copy.jpg', width: 600, height: 800 };
    } },
    'expo-file-system': { File: class {}, Paths: { cache: 'cache' } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../../contexts/ThemeContext': { useTheme: () => ({ colors: {} }) },
    './sticker-crop-editor': { default: 'Crop' },
  };
  const sandbox = { exports: {}, require: (name) => { assert.ok(mocks[name], name); return mocks[name]; } };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, sandbox);
  const tree = sandbox.exports.default({ uri: 'file:///original.jpg', preserveTransparency, onDraggingChange: (active) => dragging.push(active), onClose() {}, onSave: (image) => saved.push(image) });
  const buttons = [];
  function visit(node) { if (!node) return; if (Array.isArray(node)) return node.forEach(visit); if (node.type === 'Button') buttons.push(node); if (node.props?.onResponderGrant) canvases.push(node); visit(node.props?.children); }
  visit(tree);
  return { calls, saved, dragging, effects, canvas: canvases[0]?.props, press: async (label) => { const button = buttons.find((node) => node.props.children.props.children === label); assert.ok(button); assert.equal(button.props.disabled, false); button.props.onPress(); await new Promise(setImmediate); } };
}

test('drawing locks parent scrolling and releases it on finger-up, interruption, and unmount', () => {
  const s = setup();
  const event = { nativeEvent: { locationX: 20, locationY: 30 } };
  s.canvas.onResponderGrant(event);
  assert.equal(s.canvas.onResponderTerminationRequest(), false);
  s.canvas.onResponderRelease();
  s.canvas.onResponderGrant(event);
  s.canvas.onResponderTerminate();
  s.canvas.onResponderGrant(event);
  // This cleanup is intentionally separate from photo loading/file cleanup.
  const cleanupEffect = s.effects.find((fn) => fn.toString().includes('draggingCallback'));
  assert.ok(cleanupEffect);
  cleanupEffect()();
  assert.deepEqual(s.dragging, [true, false, true, false, true, false]);
});

test('both embedded editors connect gesture locks to their scrolling container', () => {
  for (const name of ['share-preview', 'sticker-studio']) {
    const parent = fs.readFileSync(path.join(__dirname, `../src/components/chat/${name}.tsx`), 'utf8');
    assert.match(parent, /scrollEnabled=\{!isDragging\}/);
    assert.match(parent, /onDraggingChange=/);
  }
  assert.match(source, /onDragging=\{updateDragging\}/);
});
test('rotation edits the working copy, not the gallery original', async () => {
  const s = setup(); await s.press('Rotate 90°');
  assert.equal(s.calls[0].uri, 'file:///working-copy.jpg');
  assert.equal(s.calls[0].actions[0].rotate, 90);
});
test('Done returns a new JPEG to the sharing preview', async () => {
  const s = setup(); await s.press('Done');
  assert.equal(s.calls[0].options.format, 'jpeg');
  assert.equal(s.saved[0].uri, 'file:///edited-copy.jpg');
});

test('sticker editing preserves transparency using PNG output', async () => {
  const s = setup(true); await s.press('Done');
  assert.equal(s.calls[0].options.format, 'png');
  const studio = fs.readFileSync(path.join(__dirname, '../src/components/chat/sticker-studio.tsx'), 'utf8');
  assert.match(studio, /PhotoEditor embedded preserveTransparency/);
  assert.match(studio, /if \(preserveAnimation\)\s*\{\s*await importSticker\(ownerId, draft/);
});
test('both share entry points use caption and edited preview data', () => {
  const chat = fs.readFileSync(path.join(__dirname, '../src/screens/chat/ChatRoomScreen.tsx'), 'utf8');
  const external = fs.readFileSync(path.join(__dirname, '../src/screens/chat/ShareTargetScreen.tsx'), 'utf8');
  assert.match(chat, /item\.send\(item\)/);
  assert.match(chat, /uri: item\.uri, width: item\.width/);
  assert.match(chat, /caption\.trim\(\) \|\|/);
  assert.match(external, /attachment\.caption/);
  assert.match(external, /changes\.uri \? \{ size: undefined \}/);
});

test('share preview exposes inline editing and guards unapplied edits', () => {
  const preview = fs.readFileSync(path.join(__dirname, '../src/components/chat/share-preview.tsx'), 'utf8');
  assert.match(preview, /<PhotoEditor embedded/);
  assert.doesNotMatch(preview, /setEditingId|Edit picture ·/);
  assert.match(preview, /disabled=\{busy \|\| !items.length \|\| hasPendingEdits\}/);
  assert.match(source, /if \(embedded\) return <View/);
});

test('selected sticker hides the picker and bounds both normal and crop previews', () => {
  const studio = fs.readFileSync(path.join(__dirname, '../src/components/chat/sticker-studio.tsx'), 'utf8');
  assert.match(studio, /\{!draft && <>[\s\S]*Little moments[\s\S]*Choose GIF \/ WebP file[\s\S]*<\/>\}/);
  assert.match(studio, /Math.min\(240,/);
  assert.match(studio, /maxPreviewHeight=\{previewHeight\}/);
  assert.match(studio, /width: previewHeight, height: previewHeight/);
  assert.match(source, /size=\{Math.min\(width, previewHeight\)\}/);
});
