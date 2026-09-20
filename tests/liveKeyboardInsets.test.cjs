const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/screens/chat/ChatRoomScreen.tsx'), 'utf8');
const start = source.indexOf('const measureAndroidKeyboardOverlap =');
const end = source.indexOf('const scheduleKeyboardMetricSync =', start);
function setup() {
  let snapshot = { visible: true, overlap: 200 }, padding = 0;
  const context = {
    Platform: { OS: 'android' }, useCallback: (f) => f, insets: { top: 24, bottom: 24 },
    keyboardScreenActiveRef: { current: true }, keyboardMeasurementGenerationRef: { current: 0 },
    chatViewportRef: { current: {} }, findNodeHandle: () => 1,
    readKeyboardInsets: async () => snapshot, hasLiveKeyboardInsets: () => true,
    // RN still reports its initial frame, and may even think the IME is hidden.
    Keyboard: { metrics: () => ({ screenY: 600, height: 200 }), isVisible: () => false },
    setAndroidKeyboardOverlap: (f) => { padding = typeof f === 'function' ? f(padding) : f; },
    requestAnimationFrame: (f) => f(),
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source.slice(start, end) + '\nglobalThis.sync = syncKeyboardMetrics;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return { context, set: (s) => { snapshot = s; }, padding: () => padding, sync: async () => { context.sync(true); await new Promise(setImmediate); } };
}
test('toolbar height changes use fresh insets even without a new RN keyboard event', async () => {
  const s = setup(); await s.sync(); assert.equal(s.padding(), 200);
  s.set({ visible: true, overlap: 248 }); await s.sync(); assert.equal(s.padding(), 248);
  s.set({ visible: true, overlap: 200 }); await s.sync(); assert.equal(s.padding(), 200);
});
test('native resize consumes overlap without a double lift; hide clears it', async () => {
  const s = setup(); await s.sync();
  s.set({ visible: true, overlap: 0 }); await s.sync(); assert.equal(s.padding(), 0);
  s.set({ visible: false, overlap: 248 }); await s.sync(); assert.equal(s.padding(), 0);
});
test('late snapshot cannot move a chat after leaving it', async () => {
  const s = setup(); s.context.sync(true); s.context.keyboardScreenActiveRef.current = false;
  await new Promise(setImmediate); assert.equal(s.padding(), 0);
});
