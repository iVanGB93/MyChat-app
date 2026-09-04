const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(
  path.join(__dirname, '../src/utils/image-viewer-gestures.ts'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleValue = { exports: {} };
vm.runInNewContext(compiled, { module: moduleValue, exports: moduleValue.exports, Math, Number });
const { clampImageZoom, clampImageTranslation, touchDistance } = moduleValue.exports;

test('pinch distance uses both touch points', () => {
  assert.equal(touchDistance([{ pageX: 10, pageY: 20 }, { pageX: 40, pageY: 60 }]), 50);
  assert.equal(touchDistance([{ pageX: 10, pageY: 20 }]), 0);
});

test('fullscreen zoom stays between 1x and 4x', () => {
  assert.equal(clampImageZoom(0.25), 1);
  assert.equal(clampImageZoom(2.75), 2.75);
  assert.equal(clampImageZoom(12), 4);
  assert.equal(clampImageZoom(Number.NaN), 1);
});

test('panning is disabled at 1x and bounded while zoomed', () => {
  assert.equal(clampImageTranslation(100, 1, 400), 0);
  assert.equal(clampImageTranslation(1000, 2, 400), 200);
  assert.equal(clampImageTranslation(-1000, 3, 600), -600);
});
