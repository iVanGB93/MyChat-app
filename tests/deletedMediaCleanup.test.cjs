const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/deleted-media-cleanup.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(job, options = {}) {
  const removed = [], finished = [];
  const state = { currentState: options.background ? 'background' : 'active' };
  const modules = {
    'react-native': { AppState: state },
    'expo-file-system': {
      Paths: { cache: { uri: 'file:///cache/' }, document: { uri: 'file:///documents/' } },
      File: class { constructor(uri) { this.uri = uri; this.exists = true; } delete() { removed.push(this.uri); } },
    },
    'expo-file-system/legacy': {
      getInfoAsync: async () => ({ exists: true }),
      StorageAccessFramework: {
        readDirectoryAsync: async () => options.entries ?? [],
        deleteAsync: async (uri) => { removed.push(uri); },
      },
    },
    './localMessageStore': {
      getMediaDeletionJobs: async () => [job],
      finishMediaDeletionJob: async (...args) => { finished.push(args); },
      hasLiveMediaReference: async () => !!options.shared,
    },
    './local-media-actions': { deleteGalleryAsset: async (id, uri, interactive) => {
      assert.equal(interactive, false);
      if (options.denied) throw new Error('denied');
      removed.push(uri); return true;
    } },
    './media-export-service': { getDownloadsDirectoryUri: async () => 'content://selected/Axonic' },
  };
  const sandbox = { exports: {}, require: (name) => {
    assert.ok(modules[name], name); return modules[name];
  } };
  vm.runInNewContext(code, sandbox);
  return { ...sandbox.exports, removed, finished };
}
const base = { message_id: 'm1', type: 'image', exported: 1, uri: 'content://gallery/7' };

test('tombstone cleanup deletes its managed gallery asset once per concurrent run', async () => {
  const app = fixture(base);
  await Promise.all([app.flushDeletedMedia(), app.flushDeletedMedia()]);
  assert.deepEqual(app.removed, [base.uri]);
  assert.equal(app.finished.length, 1);
});
test('permission failure remains pending and is not immediately retried', async () => {
  const app = fixture(base, { denied: true });
  await app.flushDeletedMedia(); await app.flushDeletedMedia();
  assert.equal(app.finished.length, 0);
  assert.equal(app.removed.length, 0);
});
test('background execution never attempts gallery removal', async () => {
  const app = fixture(base, { background: true });
  await app.flushDeletedMedia();
  assert.equal(app.removed.length, 0);
  assert.equal(app.finished.length, 0);
});
test('forwarded references preserve their file', async () => {
  const app = fixture(base, { shared: true });
  await app.flushDeletedMedia();
  assert.equal(app.removed.length, 0);
  assert.equal(app.finished.length, 1);
});
test('unmanaged original and sibling of app directory are never erased', async () => {
  for (const uri of ['content://personal/9', 'file:///documents-other/private.jpg']) {
    const app = fixture({ ...base, uri, exported: 0 });
    await app.flushDeletedMedia();
    assert.equal(app.removed.length, 0);
  }
});
test('documents must still be an exact child of the selected Axonic folder', async () => {
  const job = { ...base, type: 'document', uri: 'content://documents/one' };
  const outside = fixture(job);
  await outside.flushDeletedMedia();
  assert.equal(outside.removed.length, 0);
  assert.equal(outside.finished.length, 0);
  const inside = fixture(job, { entries: [job.uri] });
  await inside.flushDeletedMedia();
  assert.deepEqual(inside.removed, [job.uri]);
});
