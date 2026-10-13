const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const directory = 'node_modules/expo-modules-core/android/src/main/java/expo/modules/kotlin/activityresult';
const recovery = `        // Axonic: the React runtime can outlive its original Activity.
        if (!keyToRequestCode.containsKey(key)) {
          val currentActivity = activity
          check(!currentActivity.isDestroyed && !currentActivity.isFinishing) { "Activity is not ready to open media" }
          register(key, currentActivity, contract, fallbackCallback)
        }
`;
const specs = {
  'AppContextActivityResultRegistry.kt': {
    hash: 'cb866b0f357f516156824fb17176272fda625cd9aa0bcc608ec3c64a3ab10508',
    edits: [['        val requestCode = keyToRequestCode[key]\n', recovery + '        val requestCode = keyToRequestCode[key]\n']],
  },
  'AppContextActivityResultLauncher.kt': {
    hash: 'c50d1ff20cd45120efda116186078c1735fa017db0e6584ba75ae01ab77b2e25',
    edits: [
      ['import kotlinx.coroutines.suspendCancellableCoroutine', 'import kotlinx.coroutines.Dispatchers\nimport kotlinx.coroutines.withContext\nimport kotlinx.coroutines.suspendCancellableCoroutine'],
      ['suspend fun launch(input: I): O = suspendCancellableCoroutine { continuation ->', 'suspend fun launch(input: I): O = withContext(Dispatchers.Main.immediate) {\n    // Axonic: launcher registration and Activity lifecycle changes share the UI thread.\n    suspendCancellableCoroutine { continuation ->'],
      ['  abstract val contract:', '  }\n\n  abstract val contract:'],
    ],
  },
};
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
function patch(name, input) {
  const spec = specs[name];
  if (!spec) throw Error('Unknown activity-result patch target');
  const source = input.replace(/\r\n/g, '\n');
  let original = source;
  if (hash(source) !== spec.hash) {
    for (const [before, after] of spec.edits) original = original.replace(after, before);
  }
  if (hash(original) !== spec.hash) throw Error('Expo activity-result source changed; review required: ' + name);
  return spec.edits.reduce((s, [before, after]) => s.replace(before, after), original);
}
if (require.main === module) {
  for (const name of Object.keys(specs)) {
    const file = path.resolve(__dirname, '..', directory, name);
    const source = fs.readFileSync(file, 'utf8'), next = patch(name, source);
    if (source !== next) fs.writeFileSync(file, next);
  }
  console.log('Activity-result recreation recovery ready');
}
module.exports = {patch, directory, names: Object.keys(specs)};
