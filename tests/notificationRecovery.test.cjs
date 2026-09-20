const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function setup() {
  let now = 0;
  const timers = [];
  const failures = [];
  const navigations = [];
  const app = { currentState: 'background' };
  const auth = { user: {}, authLoading: false };
  let route;
  const nav = { isReady: () => true, getRootState: () => ({ routeNames: ['ChatRoom'] }),
    getCurrentRoute: () => route, navigate: (name, params) => {
      navigations.push(name); route = { name, params };
    } };
  const mocks = {
    'react-native': { AppState: app },
    '../navigation/AppNavigator': { navigationRef: nav },
    '../store/appStore': { useAppStore: { getState: () => auth } },
    './callDedupe': { isCallEnded: () => false },
    './notificationDestination': { parseNotificationDestination: () => ({ type: 'message', roomId: 'r1' }) },
    './crashReporting': { reportNotificationFailure: (...args) => failures.push(args) },
  };
  const sandbox = { exports: {}, require: (name) => {
    assert.ok(mocks[name], name); return mocks[name];
  }, Date: { now: () => now }, setTimeout: (fn, ms) => timers.push({ fn, at: now + ms }) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/notificationNavigation.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, sandbox);
  return { app, auth, nav, failures, navigations, open: sandbox.exports.navigateFromNotification,
    advance(ms) { const end = now + ms; while (timers.length && timers[0].at <= end) {
      const timer = timers.shift(); now = timer.at; timer.fn();
    } now = end; } };
}

test('notification survives background and login waits without duplicate navigation', () => {
  const s = setup(); s.open({}); s.open({}); s.advance(40_000);
  assert.equal(s.failures.length, 0);
  s.app.currentState = 'active'; s.auth.user = null; s.advance(40_000);
  assert.equal(s.failures.length, 0);
  s.auth.user = {}; s.advance(2_000);
  assert.equal(s.navigations.length, 1);
  assert.equal(s.failures.length, 0);
});

test('stale notification expires and releases its deduplication key', () => {
  const s = setup(); s.open({}); s.advance(300_000);
  assert.deepEqual(s.failures[0], ['notification-open-timeout', 'background']);
  s.app.currentState = 'active'; s.open({}); s.advance(1_000);
  assert.equal(s.navigations.length, 1);
});

test('unavailable navigator still has a bounded retry window', () => {
  const s = setup(); s.app.currentState = 'active'; s.nav.isReady = () => false;
  s.open({}); s.advance(31_000);
  assert.deepEqual(s.failures[0], ['notification-open-timeout', 'navigator']);
});
