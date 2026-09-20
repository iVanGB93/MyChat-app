const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function setup(active) {
  let hardwareBack, cleanup, prevented, onNavigationBack;
  let shown = 0, removed = 0;
  const mocks = {
    react: { useCallback: (callback) => callback },
    'react-native': { BackHandler: { addEventListener: (name, callback) => {
      assert.equal(name, 'hardwareBackPress'); hardwareBack = callback;
      return { remove: () => removed++ };
    } } },
    '@react-navigation/native': {
      useFocusEffect: (effect) => { cleanup = effect(); },
      usePreventRemove: (value, callback) => { prevented = value; onNavigationBack = callback; },
    },
  };
  const sandbox = { exports: {}, require: (name) => mocks[name] };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/hooks/use-call-navigation-guard.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, sandbox);
  sandbox.exports.useCallNavigationGuard(active, () => shown++);
  return { hardwareBack, cleanup, prevented, onNavigationBack, shown: () => shown, removed: () => removed };
}
test('active calls consume repeated Back presses and prevent route removal', () => {
  const s = setup(true);
  assert.equal(s.prevented, true);
  assert.equal(s.hardwareBack(), true);
  assert.equal(s.hardwareBack(), true);
  s.onNavigationBack();
  assert.equal(s.shown(), 3);
  s.cleanup(); assert.equal(s.removed(), 1);
});
test('ended calls release navigation so normal hangup dismissal still works', () => {
  const s = setup(false);
  assert.equal(s.prevented, false);
  assert.equal(s.hardwareBack, undefined);
});
test('guard covers ringing, connecting, and connected calls; native swipe dismissal is disabled', () => {
  const screen = fs.readFileSync(path.join(__dirname, '../src/screens/calls/ActiveCallScreen.tsx'), 'utf8');
  assert.match(screen, /useCallNavigationGuard\(status !== 'ended', keepCallVisible\)/);
  const navigator = fs.readFileSync(path.join(__dirname, '../src/navigation/AppNavigator.tsx'), 'utf8');
  assert.match(navigator, /component=\{ActiveCallScreen\}\s*options=\{\{[^}]*gestureEnabled: false/);
});
