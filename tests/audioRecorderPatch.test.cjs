const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const {patch}=require('../scripts/patch-audio-recorder.cjs');
test('audio lifecycle patch is repeatable and rejects dependency drift',()=>{const source=fs.readFileSync('node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioRecorder.kt','utf8');assert.equal(patch(patch(source)),patch(source));assert.throws(()=>patch(source.replace('recorder?.resume()','recorder?.start()')),/drift|Unsupported/);});

test('audio source guard is applied at install and Android cannot substitute its unpatched prebuilt artifact',()=>{const p=require('../package.json');assert(p.scripts.postinstall.includes('fix:audio-recorder'));assert(p.expo.autolinking.android.buildFromSource.includes('expo-audio'));});

test('ordinary audio releases communication routing instead of forcing the speaker over Bluetooth',()=>{
 const {patchRouting}=require('../scripts/patch-audio-recorder.cjs');
 const original='    audioManager.mode = if (playThroughEarpiece) AudioManager.MODE_IN_COMMUNICATION else AudioManager.MODE_NORMAL\n    audioManager.setSpeakerphoneOn(!playThroughEarpiece)';
 const result=patchRouting(original);
 assert.equal(patchRouting(result),result);
 assert(!result.includes('setSpeakerphoneOn(!playThroughEarpiece)'));
 assert(result.includes('Build.VERSION_CODES.S'));
 assert(result.includes('audioManager.clearCommunicationDevice()'));
 assert(result.includes('audioManager.setSpeakerphoneOn(false)'));
 assert(result.includes('AudioManager.MODE_IN_COMMUNICATION else AudioManager.MODE_NORMAL'));
 assert.throws(()=>patchRouting(original.replace('!playThroughEarpiece','true')),/review required/);
 const installed=fs.readFileSync('node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioModule.kt','utf8');
 assert.equal(patchRouting(installed),installed);
});
