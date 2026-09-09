const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, extras = {}) {
  let cursor = 0;
  const slots = [];
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef: (initial) => { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo: (fn) => fn(), useCallback: (fn) => fn, useContext: () => null,
    useEffect: (fn) => fn(),
  };
  const adapters = { react, '../components/ui/ConfirmModal': 'ConfirmModal', ...extras };
  const context = { exports: {}, require: (key) => {
    assert.ok(key in adapters, `Unexpected module ${key}`);
    return adapters[key];
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, context);
  return { render: (fn) => { cursor = 0; return fn(context.exports); } };
}

test('simultaneous confirmations preserve order and stale close cannot skip a dialog', () => {
  const app = load('src/contexts/ConfirmContext.tsx');
  const render = () => app.render(({ ConfirmProvider }) => ConfirmProvider({ children: null }));
  let tree = render();
  tree.props.value.confirm({ title: 'First' });
  tree.props.value.confirm({ title: 'Second' });
  tree = render();
  const first = tree.props.children[1];
  assert.equal(first.props.title, 'First');
  tree.props.value.alert('Third');
  first.props.onClose();
  tree = render();
  const second = tree.props.children[1];
  assert.notEqual(first.props.key, second.props.key);
  assert.equal(second.props.title, 'Second');
  first.props.onClose();
  assert.equal(render().props.children[1].props.title, 'Second');
  second.props.onClose();
  assert.equal(render().props.children[1].props.title, 'Third');
});

test('rapid confirmation taps run the action and close only once', () => {
  const animations = [];
  const app = load('src/components/ui/ConfirmModal.tsx', {
    'react-native': {
      Animated: { Value: class { setValue() {} }, View: 'AnimatedView',
        spring: () => ({}), timing: () => ({}),
        parallel: () => ({ start: (fn) => { if (fn) animations.push(fn); } }) },
      Modal: 'Modal', Pressable: 'Pressable', Text: 'Text', TouchableOpacity: 'Button', View: 'View',
      StyleSheet: { create: (styles) => styles },
    },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '../../theme': { Font: { size: {} }, Radius: {}, Spacing: {} },
    '../../contexts/ThemeContext': { useTheme: () => ({ colors: {} }) },
  });
  let closed = 0, actions = 0;
  const tree = app.render(({ default: Modal }) => Modal({ visible: true, title: 'Delete?',
    onClose: () => closed++, buttons: [{ text: 'Delete', onPress: () => actions++ }] }));
  function find(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'Button') return node;
    for (const child of (node.props?.children ?? []).flat(Infinity)) {
      const result = find(child); if (result) return result;
    }
    return null;
  }
  const button = find(tree);
  button.props.onPress();
  button.props.onPress();
  assert.equal(animations.length, 1);
  animations[0]();
  assert.equal(closed, 1);
  assert.equal(actions, 1);
});
