const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual lifecycle effect with fake timers/native focus.
const source = fs.readFileSync(path.join(__dirname, '../src/screens/chat/ChatRoomScreen.tsx'), 'utf8');
const end = source.indexOf('}, [isScreenFocused, appState, scheduleKeyboardMetricSync, syncKeyboardMetrics]);');
const start = source.lastIndexOf('useEffect(() => {', end);
const effect = source.slice(start, end + '}, [isScreenFocused, appState, scheduleKeyboardMetricSync, syncKeyboardMetrics]);'.length);
function run(focused, appState, inputFocused) {
  const calls = []; let tick; let cleanup;
  const context = {
    Platform: { OS: 'android' }, isScreenFocused: focused, appState,
    composerInputRef: { current: { isFocused: () => inputFocused } },
    composerFocusedRef: { current: false },
    keyboardMeasurementGenerationRef: { current: 0 }, keyboardResyncTimersRef: { current: [1] },
    Keyboard: { isVisible: () => false },
    setAndroidKeyboardOverlap: (value) => calls.push(['overlap', value]),
    scheduleKeyboardMetricSync: () => calls.push(['schedule']),
    syncKeyboardMetrics: () => calls.push(['sync']),
    clearTimeout: () => {}, clearInterval: () => calls.push(['stop']),
    setInterval: (callback) => { tick = callback; return 1; },
    useEffect: (callback) => { cleanup = callback(); },
  };
  vm.runInNewContext(effect, context);
  return { calls, tick, cleanup, context };
}
test('resuming a focused chat remeasures, checks focused input, and stops on cleanup', () => {
  const s = run(true, 'active', true);
  assert.deepEqual(s.calls, [['schedule']]);
  s.tick(); assert.deepEqual(s.calls[1], ['sync']);
  s.cleanup(); assert.deepEqual(s.calls[2], ['stop']);
  assert.equal(s.context.keyboardMeasurementGenerationRef.current, 2);
});
test('hidden/background chats reset stale overlap without starting a watchdog', () => {
  for (const [focus, state] of [[false, 'active'], [true, 'background']]) {
    const s = run(focus, state, true);
    assert.deepEqual(s.calls, [['overlap', 0]]);
    assert.equal(s.tick, undefined);
  }
});
test('idle visible chat does not repeatedly measure without keyboard or input focus', () => {
  const s = run(true, 'active', false); s.tick();
  assert.deepEqual(s.calls, [['schedule']]); s.cleanup();
});
