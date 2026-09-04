const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/utils/audio-seek.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleValue = { exports: {} };
vm.runInNewContext(compiled, { module: moduleValue, exports: moduleValue.exports, Math, Number });
const { audioPositionFromTrack, clampAudioPosition, nextVoicePlaybackRate } = moduleValue.exports;

test('tapping the voice track seeks to the matching second', () => {
  assert.equal(audioPositionFromTrack(75, 300, 60_000), 15_000);
  assert.equal(audioPositionFromTrack(150, 300, 60_000), 30_000);
  assert.equal(audioPositionFromTrack(300, 300, 60_000), 60_000);
});

test('dragging outside the voice track stays inside the recording', () => {
  assert.equal(audioPositionFromTrack(-50, 300, 60_000), 0);
  assert.equal(audioPositionFromTrack(500, 300, 60_000), 60_000);
  assert.equal(clampAudioPosition(80_000, 60_000), 60_000);
});

test('unknown dimensions and durations safely seek to the beginning', () => {
  assert.equal(audioPositionFromTrack(50, 0, 60_000), 0);
  assert.equal(audioPositionFromTrack(50, 300, 0), 0);
  assert.equal(clampAudioPosition(Number.NaN, 60_000), 0);
});

test('voice playback speed cycles through every supported rate', () => {
  assert.equal(nextVoicePlaybackRate(1), 1.5);
  assert.equal(nextVoicePlaybackRate(1.5), 2);
  assert.equal(nextVoicePlaybackRate(2), 1);
  assert.equal(nextVoicePlaybackRate(1.25), 1);
});
