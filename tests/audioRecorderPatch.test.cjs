const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const {patch}=require('../scripts/patch-audio-recorder.cjs');
test('audio lifecycle patch is repeatable and rejects dependency drift',()=>{const source=fs.readFileSync('node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioRecorder.kt','utf8');assert.equal(patch(patch(source)),patch(source));assert.throws(()=>patch(source.replace('recorder?.resume()','recorder?.start()')),/drift|Unsupported/);});

test('audio source guard is applied at install and Android cannot substitute its unpatched prebuilt artifact',()=>{const p=require('../package.json');assert(p.scripts.postinstall.includes('fix:audio-recorder'));assert(p.expo.autolinking.android.buildFromSource.includes('expo-audio'));});
