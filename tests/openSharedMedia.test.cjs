const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/open-shared-media.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture({ storedUri, external = false, missing = false } = {}) {
  const intents = [], copies = [];
  class File {
    constructor(root, name) { this.uri = name ? `${root}/${name}` : root; this.name = 'clip.mp4'; this.type = 'application/octet-stream'; this.exists = !missing; }
    get contentUri() {
      if (external && !this.uri.startsWith('cache/')) throw new Error('Outside provider roots');
      return `content://provider/${this.name}`;
    }
    copy(target) { copies.push(target.uri); }
    delete() {}
  }
  const modules = {
    'react-native': { Platform: { OS: 'android' }, Linking: {} },
    'expo-file-system': { File, Paths: { cache: 'cache' } },
    'expo-intent-launcher': { startActivityAsync: async (action, options) => intents.push({ action, ...options }) },
    './localMessageStore': { getMessagesByIds: async () => storedUri ? [{ file_uri: storedUri }] : [] },
  };
  const sandbox = { exports: {}, require: (name) => modules[name] };
  vm.runInNewContext(compiled, sandbox);
  return { open: sandbox.exports.openSharedMedia, intents, copies };
}

test('opens the latest Gallery URI with a video MIME and read grant', async () => {
  const f = fixture({ storedUri: 'content://media/video/123' });
  await f.open('file://deleted-original.mp4', 'video', 'message');
  assert.equal(f.intents[0].data, 'content://media/video/123');
  assert.equal(f.intents[0].type, 'video/*');
  assert.equal(f.intents[0].flags, 1);
  assert.equal(f.copies.length, 0);
});

test('external Gallery paths outside provider roots get a readable cache URI', async () => {
  const f = fixture({ external: true });
  await f.open('file:///storage/DCIM/clip.mp4', 'video');
  assert.equal(f.copies.length, 1);
  assert.match(f.intents[0].data, /^content:/);
});

test('a deleted local video reports unavailability instead of launching a broken viewer', async () => {
  const f = fixture({ missing: true });
  await assert.rejects(f.open('file://gone.mp4', 'video'), /no longer available/);
  assert.equal(f.intents.length, 0);
});
