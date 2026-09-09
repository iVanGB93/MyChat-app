const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/sticker-crop.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { stickerCrop } = context.exports;
test('selection stays square and within portrait, landscape and tiny images', () => {
  for (const [width, height] of [[4000, 3000], [3000, 4000], [512, 512], [1, 1]]) {
    for (const x of [-1, 0, .5, 1, 2]) for (const y of [-1, 0, .5, 1, 2]) for (const fraction of [-1, .15, .5, 1, 2]) {
      const crop = stickerCrop(width, height, x, y, fraction);
      assert.equal(crop.width, crop.height);
      assert.ok(crop.width >= 1);
      assert.ok(crop.originX >= 0 && crop.originY >= 0);
      assert.ok(crop.originX + crop.width <= width);
      assert.ok(crop.originY + crop.height <= height);
      Object.values(crop).forEach(value => assert.ok(Number.isInteger(value)));
    }
  }
});
test('centered and resized selection maps to source pixels', () => {
  const full = stickerCrop(400, 200, .5, .5, 1);
  assert.equal(full.originX, 100);
  assert.equal(full.originY, 0);
  assert.equal(full.width, 200);
  const smaller = stickerCrop(400, 200, .5, .5, .5);
  assert.equal(smaller.originX, 150);
  assert.equal(smaller.originY, 50);
  assert.equal(smaller.width, 100);
});
