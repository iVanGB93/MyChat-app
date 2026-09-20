const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sandbox = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/video-quality.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, sandbox);
const policy = sandbox.exports.videoQualityParameters;

test('automatic retains existing adaptive bitrate and resolution behavior', () => {
  for (const [level, bitrate] of [['poor', 500000], ['fair', 1200000], ['good', 2500000], ['unknown', 2500000]]) {
    const p = policy('automatic', level);
    assert.equal(p.maxBitrate, bitrate);
    assert.equal(p.maxFramerate, 30);
    assert.equal(p.scaleResolutionDownBy, 1);
  }
});
test('manual preferences are not overwritten by connection quality changes', () => {
  for (const mode of ['low', 'medium', 'high']) {
    for (const level of ['poor', 'fair', 'good', 'unknown']) {
      assert.deepEqual(policy(mode, level), policy(mode, 'good'));
    }
  }
});
test('data saving modes reduce bitrate, frame rate and encoded resolution', () => {
  const low = policy('low', 'good'), medium = policy('medium', 'good'), high = policy('high', 'good');
  assert.ok(low.maxBitrate < medium.maxBitrate && medium.maxBitrate < high.maxBitrate);
  assert.ok(low.maxFramerate < medium.maxFramerate && medium.maxFramerate < high.maxFramerate);
  assert.ok(low.scaleResolutionDownBy > medium.scaleResolutionDownBy && medium.scaleResolutionDownBy > high.scaleResolutionDownBy);
  assert.equal(low.degradationPreference, 'balanced');
  assert.equal(high.degradationPreference, 'maintain-resolution');
});
