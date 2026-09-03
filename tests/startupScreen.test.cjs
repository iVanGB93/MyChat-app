const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { expo } = require('../app.json');
const theme = require('../src/theme/index.ts');

const source = fs.readFileSync(path.join(__dirname, '../src/components/startup-screen.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;

function render(width = 412, height = 915) {
  const adapters = {
    react: { createElement: (type, props, ...children) => ({ type, props, children }) },
    'react-native': { View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator', useWindowDimensions: () => ({ width, height }) },
    'expo-image': { Image: 'Image' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) },
    '../theme': theme,
    '../../assets/icon.png': 'app-icon',
  };
  const sandbox = { exports: {}, require(name) {
    assert.ok(name in adapters, `Unexpected dependency ${name}`);
    return adapters[name];
  } };
  vm.runInNewContext(compiled, sandbox);
  return sandbox.exports.default();
}

test('native startup uses the existing icon and app dark background in both themes', () => {
  const splash = expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen')[1];
  assert.equal(expo.backgroundColor, theme.DarkColors.background);
  assert.equal(expo.splash.backgroundColor, theme.DarkColors.background);
  assert.equal(expo.splash.image, expo.icon);
  assert.equal(splash.image, expo.icon);
  assert.equal(splash.backgroundColor, theme.DarkColors.background);
  assert.equal(splash.dark.backgroundColor, splash.backgroundColor);
  assert.equal(splash.dark.image, splash.image);
  assert.equal(splash.imageWidth, 176);
  assert.equal(splash.resizeMode, 'contain');
});

test('loading screen renders the real icon, readable branding and cyan progress', () => {
  const screen = render();
  assert.equal(screen.props.style.backgroundColor, theme.DarkColors.background);
  assert.equal(screen.children[0].children[0].props.source, 'app-icon');
  assert.equal(screen.children[0].children[0].props.contentFit, 'contain');
  assert.equal(screen.children[1].children[0], 'AXONIC');
  assert.equal(screen.children[1].props.style.color, theme.DarkColors.text);
  assert.equal(screen.children[2].props.color, theme.DarkColors.primary);
  assert.equal(screen.children[2].props.accessibilityLabel, 'Loading Axonic');
});

test('icon scales down for small screens and respects safe areas', () => {
  const screen = render(280, 400);
  const size = screen.children[0].props.style.width;
  assert.ok(size > 0 && size < 176);
  assert.equal(screen.children[0].props.style.height, size);
  assert.equal(screen.props.style.paddingTop, 24);
  assert.equal(screen.props.style.paddingBottom, 24);
});

test('theme hydration and authentication share the same loading screen', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(read('src/contexts/ThemeContext.tsx'), /if \(!loaded\) return <StartupScreen \/>;/);
  assert.match(read('src/navigation/AppNavigator.tsx'), /if \(isLoading\) \{\s*return <StartupScreen \/>;/);
});
