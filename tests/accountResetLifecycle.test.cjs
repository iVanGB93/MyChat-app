const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, relative), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { exports: {}, require(name) {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  } };
  vm.runInNewContext(compiled, sandbox);
  return sandbox.exports;
}

function fixture() {
  return load('../src/store/appStore.ts', {
    zustand: require('zustand'),
    'zustand/middleware': {
      persist: (initializer) => initializer,
      createJSONStorage: () => undefined,
    },
    '@react-native-async-storage/async-storage': { default: {} },
    '../services/presencePolicy': {},
    '../utils/messagePreview': {},
  }).useAppStore;
}

for (const lifecycle of ['active', 'background', 'inactive', 'unknown']) {
  test(`account reset preserves ${lifecycle} lifecycle and clears account state`, () => {
    const store = fixture();
    store.setState({ appLifecycle: lifecycle, net: 'online', user: { id: 1 },
      activeRoomId: 'old-room', unreadByRoom: { 'old-room': 3 },
      activeCall: { callId: 'old-call', state: 'connected' } });
    store.getState().reset();
    const state = store.getState();
    assert.equal(state.appLifecycle, lifecycle);
    assert.equal(state.net, 'online');
    assert.equal(state.user, null);
    assert.equal(state.activeCall, null);
    assert.equal(state.activeRoomId, null);
    assert.equal(Object.keys(state.unreadByRoom).length, 0);

    const policy = load('../src/services/notificationDecision.ts', {});
    const decision = policy.decideIncomingCallInApp(
      { event: 'incoming_call', call_id: 'new-call' },
      { appActive: state.appLifecycle === 'active', activeCall: state.activeCall });
    assert.equal(decision.allow, lifecycle === 'active');
  });
}
