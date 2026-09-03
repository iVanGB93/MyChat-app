const test = require('node:test');
const assert = require('node:assert/strict');
const { getAndroidKeyboardOverlap } = require('../src/utils/keyboard-layout.ts');

const base = {
  keyboard: { screenY: 600, height: 276 },
  viewportY: 56, viewportHeight: 820, screenHeight: 900,
  windowTopInset: 24, navigationBarInset: 24,
};
const overlap = (changes = {}) => getAndroidKeyboardOverlap({ ...base, ...changes });

test('normalizes the top inset: the previous calculation left 24dp of the composer covered', () => {
  assert.equal(overlap(), 300);
});
test('handles taller status bars without a hardcoded keyboard offset', () => {
  assert.equal(overlap({ windowTopInset: 40, viewportHeight: 804 }), 300);
});
test('does not double-lift when Android already resized the viewport', () => {
  assert.equal(overlap({ viewportHeight: 520 }), 0);
});
test('covers only the remaining overlap after partial native resizing', () => {
  assert.equal(overlap({ viewportHeight: 570 }), 50);
});
test('docked keyboard above a 48dp three-button navigation bar is not floating', () => {
  assert.equal(overlap({ keyboard: { screenY: 600, height: 252 }, navigationBarInset: 48 }), 300);
});
test('missing screenY fallback also includes the navigation bar', () => {
  for (const screenY of [0, NaN, 900, -1]) {
    assert.equal(overlap({ keyboard: { screenY, height: 252 }, navigationBarInset: 48 }), 300);
  }
});
test('floating keyboard leaves the composer in place', () => {
  assert.equal(overlap({ keyboard: { screenY: 350, height: 250 } }), 0);
});
test('hidden and invalid keyboard frames never add padding', () => {
  for (const height of [0, -1, NaN, Infinity]) assert.equal(overlap({ keyboard: { screenY: 600, height } }), 0);
  assert.equal(overlap({ viewportHeight: 0 }), 0);
});
test('viewport above the keyboard and inset-free layouts stay bounded', () => {
  assert.equal(overlap({ viewportHeight: 480 }), 0);
  assert.equal(overlap({ viewportY: 0, viewportHeight: 900, windowTopInset: 0 }), 300);
  assert.equal(overlap({ keyboard: { screenY: 1, height: 899 } }), 820);
});
