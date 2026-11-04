const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/components/chat/photo-editor.tsx'), 'utf8');
function setup(preserveTransparency = false, options = {}) {
  const calls = [], saved = [], dragging = [], effects = [], canvases = [];
  let stateIndex = 0;
  const initial = [{ uri: 'file:///working-copy.jpg', width: options.width ?? 800, height: options.height ?? 600 }, options.busy ?? false, true, options.mode ?? 'draw'];
  const mocks = {
    '@expo/vector-icons': {Ionicons:'Icon'},
    '../../theme': require('./helpers/theme.cjs'),
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
    '../ui/ScreenHeader': {default:'Header'},
    '../ui/KeyboardForm': {KeyboardAvoidingScreen:'KeyboardScreen',KeyboardFormScrollView:'Scroll',KeyboardAwareTextInput:'Input'},
  };
  const sandbox = { exports: {}, require: (name) => { const locale=require('./helpers/localization.cjs')(name);if(locale)return locale; assert.ok(mocks[name], name); return mocks[name]; } };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, sandbox);
  const tree = sandbox.exports.default({ uri: 'file:///original.jpg', floatingTools: options.floatingTools, preserveTransparency, onDraggingChange: (active) => dragging.push(active), onClose() {}, onSave: (image) => saved.push(image) });
  const buttons = [];
  function visit(node) { if (!node) return; if (Array.isArray(node)) return node.forEach(visit); if (node.type === 'Button') buttons.push(node); if (node.props?.onResponderGrant) canvases.push(node); visit(node.props?.children); visit(node.props?.trailing); }
  visit(tree);
  return { tree, buttons, calls, saved, dragging, effects, canvas: canvases[0]?.props, press: async (label) => { const button = buttons.find((node) => node.props.children.props.children === label); assert.ok(button); assert.equal(button.props.disabled, false); button.props.onPress(); await new Promise(setImmediate); } };
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

test('sticker editing uses the shared full-screen floating editor', () => {
  const studio = fs.readFileSync(path.join(__dirname, '../src/components/chat/sticker-studio.tsx'), 'utf8');
  assert.match(studio, /draft&&editing&&<PhotoEditor floatingTools preserveTransparency/);
  assert.match(studio, /accessibilityLabel=\{t\("Edit sticker"\)\}/);
  assert.match(studio, /accessibilityLabel=\{t\("Finish naming sticker"\)\}/);
  assert.doesNotMatch(studio, /<PhotoEditor embedded/);
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
  assert.match(studio, /PhotoEditor floatingTools preserveTransparency/);
  assert.match(studio, /if \(preserveAnimation\)\s*\{\s*await importSticker\(ownerId, draft/);
});

test('sticker creation uses a compact square preview and preserves opt-in editing', () => {
  const studio = fs.readFileSync(path.join(__dirname, '../src/components/chat/sticker-studio.tsx'), 'utf8');
  assert.match(studio, /!draft \? <KeyboardFormScrollView/);
  assert.match(studio, /contentFit="contain" style=\{\{width:previewSize,height:previewSize\}\}/);
  assert.match(studio, /preserveAnimation===false&&<TouchableOpacity/);
  assert.doesNotMatch(studio, /Math.min\(240,/);
});

function findNode(tree, predicate) {
  if (!tree) return;
  if (Array.isArray(tree)) return tree.map(node => findNode(node, predicate)).find(Boolean);
  if (predicate(tree)) return tree;
  return findNode(tree.props?.children, predicate);
}
test('floating editor keeps stage and toolbar geometry across modes and loading', () => {
  for (const dimensions of [{width:600,height:1200},{width:1200,height:600}]) {
    for (const mode of ['preview','draw','text','crop']) {
      for (const busy of [false,true]) {
        const s = setup(false, {...dimensions, mode, busy, floatingTools:true});
        const stage = findNode(s.tree, node => node.props?.testID === 'photo-editor-stage');
        assert.equal(stage.props.style.width, 384);
        assert.equal(stage.props.style.height, 718);
        const toolbar = findNode(stage, node => node.props?.style?.top === 4);
        assert.ok(toolbar, 'same toolbar remains inside every mode');
        assert.equal(s.buttons.filter(node => node.props.accessibilityLabel === 'Crop').length, 1);
        if (mode === 'crop') {
          const crop = findNode(stage, node => node.type === 'Crop');
          assert.equal(crop.props.viewport.width, 384);
          assert.equal(crop.props.viewport.height, 718);
          assert.equal(crop.props.imageDimensions.width, dimensions.width);
          assert.equal(s.buttons.filter(node=>node.props.accessibilityLabel==='Apply crop').length,0,'crop actions live only in crop component slot');
          assert.equal(crop.props.actions.props.children.length,2);
        }
        if (busy) assert.ok(findNode(stage, node => node.type === 'Spinner'));
      }
    }
  }
});
