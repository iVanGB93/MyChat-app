const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/services/notificationNavigation.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const timers = [];
  const navigations = [];
  const auth = { authLoading: true, user: null, activeCall: null };
  let routeNames = ['Login'];
  let currentRoute = { name: 'Login' };
  let throwNextNavigation = false;
  let now = 0;
  const navigationRef = {
    isReady: () => true,
    getRootState: () => ({ routeNames }),
    getCurrentRoute: () => currentRoute,
    navigate(name, params) {
      navigations.push({ name, params });
      if (throwNextNavigation) {
        throwNextNavigation = false;
        throw new Error('navigator detached during auth transition');
      }
      currentRoute = { name, params };
    },
  };
  const modules = {
    '../navigation/AppNavigator': { navigationRef },
    '../store/appStore': { useAppStore: { getState: () => auth } },
    './callDedupe': { isCallEnded: () => false },
    './notificationDestination': {
      parseNotificationDestination: (raw) => raw?.roomId
        ? { type: 'message', roomId: raw.roomId, roomName: raw.roomName || '', otherUserId: raw.otherUserId }
        : null,
    },
  };
  class TestDate extends Date {
    static now() { now += 1_100; return now; }
  }
  const sandbox = {
    exports: {},
    Date: TestDate,
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    require(name) {
      assert.ok(name in modules, `Unexpected dependency ${name}`);
      return modules[name];
    },
  };
  vm.runInNewContext(compiled, sandbox);
  return {
    navigateFromNotification: sandbox.exports.navigateFromNotification,
    auth,
    navigations,
    setRoutes: (names) => { routeNames = names; },
    throwNextNavigation: () => { throwNextNavigation = true; },
    runNextTimer: () => timers.shift()?.(),
    timerCount: () => timers.length,
  };
}

test('notification waits for the authenticated stack before opening a chat', () => {
  const app = fixture();
  app.navigateFromNotification({ roomId: 'room-1', roomName: 'Ana', otherUserId: 7 });
  assert.equal(app.navigations.length, 0);
  assert.equal(app.timerCount(), 1);

  app.auth.authLoading = false;
  app.auth.user = { id: 3 };
  app.setRoutes(['Main', 'ChatRoom', 'IncomingCall']);
  app.runNextTimer();
  assert.equal(app.navigations.length, 1);
  assert.equal(app.navigations[0].name, 'ChatRoom');
  assert.equal(app.navigations[0].params.roomId, 'room-1');
});

test('a navigator detach during a notification tap is caught and retried', () => {
  const app = fixture();
  app.auth.authLoading = false;
  app.auth.user = { id: 3 };
  app.setRoutes(['Main', 'ChatRoom', 'IncomingCall']);
  app.throwNextNavigation();

  assert.doesNotThrow(() => {
    app.navigateFromNotification({ roomId: 'room-2', roomName: 'Family' });
  });
  assert.equal(app.navigations.length, 1);
  assert.equal(app.timerCount(), 1);

  assert.doesNotThrow(() => app.runNextTimer());
  assert.equal(app.navigations.length, 2);
  assert.equal(app.navigations[1].params.roomId, 'room-2');
});
