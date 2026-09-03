const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const policy = require('../src/services/mediaTransferPolicy.ts');

// Run the actual transfer orchestration with native filesystem/network adapters.
// Node's Blob accepts byte arrays, unlike RN's Blob: forbid File.slice/bytes here
// so a passing Node-only test cannot conceal that native regression again.
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/services/mediaLane.ts'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } },
).outputText;
const MB = 1024 * 1024;
const MD5 = '12345678901234567890123456789012';
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture(options = {}) {
  const size = options.size ?? 20 * MB;
  const partSize = 8 * MB;
  const files = new Map([['file:///source.bin', { size, md5: MD5 }]]);
  const reads = [], uploads = [], apiCalls = [], nativeCalls = [], downloads = [];
  let openHandles = 0, peakParts = 0, activeParts = 0, tokenCalls = 0, refreshCalls = 0;
  let token = 'initial-token';
  const uploadedParts = new Set(options.uploadedParts ?? []);
  class Directory {
    constructor(...parts) { this.uri = parts.map((p) => p.uri ?? p).join('/'); }
    exists = true;
    create() {}
  }
  class File {
    constructor(...parts) { this.uri = parts.map((p) => p.uri ?? p).join('/'); }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.size ?? 0; }
    get md5() { throw new Error('File.md5 must never buffer a whole attachment in native memory'); }
    slice() { throw new Error('File.slice must never be used for native uploads'); }
    bytesSync() { throw new Error('Whole-file JS reads are forbidden'); }
    arrayBuffer() { throw new Error('Whole-file JS buffering is forbidden'); }
    open() {
      openHandles++;
      return {
        offset: 0,
        readBytes(length) {
          assert.ok(length <= partSize, `unbounded read: ${length}`);
          const start = this.offset;
          reads.push({ start, length });
          this.offset += length;
          const bytes = new Uint8Array(options.shortRead ? length - 1 : length);
          bytes[0] = start / partSize;
          bytes[bytes.length - 1] = 97;
          return bytes;
        },
        close() { openHandles--; },
      };
    }
    delete() { files.delete(this.uri); }
    move(dest) {
      files.set(dest.uri, files.get(this.uri));
      files.delete(this.uri);
      this.uri = dest.uri;
    }
    static async downloadFileAsync(url, dest, opts) {
      downloads.push({ url, dest: dest.uri, ...opts });
      if (options.download) await options.download(downloads.length, { url, dest, opts, files });
      files.set(dest.uri, { size: options.downloadSize ?? size, md5: options.downloadMd5 ?? MD5 });
      return new File(dest.uri);
    }
  }
  const metadata = { media_id: 'media-1', md5: MD5, sha256: '', size_bytes: size, mime: 'application/octet-stream' };
  const api = { async post(url, body) {
    apiCalls.push({ url, body });
    if (url.endsWith('/initiate/')) {
      if (options.initiateError) throw options.initiateError;
      return { data: {
        ...metadata, uploaded: false,
        ...(options.single ? { upload_mode: 'single', upload_url: 'https://storage.example/single', upload_headers: { 'x-amz-meta-md5': MD5 } } : {
          upload_mode: 'multipart', part_size: partSize,
          parts: Array.from({ length: Math.ceil(size / partSize) }, (_, i) => ({
            part_number: i + 1, uploaded: uploadedParts.has(i + 1), upload_url: `https://storage.example/${i + 1}`,
          })),
        }),
      } };
    }
    if (options.completeError) throw options.completeError;
    return { data: metadata };
  } };
  const adapters = {
    'expo-file-system': { File, Directory, Paths: { document: 'file:///documents' } },
    'expo-file-system/legacy': {
      async getInfoAsync(uri, opts) {
        assert.equal(opts.md5, true);
        const file = files.get(uri);
        return file ? { exists: true, size: file.size, md5: file.md5 } : { exists: false };
      },
      FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
      createUploadTask(url, uri, opts) {
        nativeCalls.push({ url, uri, opts });
        return {
          cancelAsync: async () => {},
          uploadAsync: async () => options.nativeUpload
            ? options.nativeUpload(nativeCalls.length, { url, uri, opts })
            : { status: 200, body: JSON.stringify(metadata) },
        };
      },
    },
    'expo/fetch': { async fetch(url, opts) {
      const part = Number(url.split('/').pop());
      assert.ok(opts.body instanceof Uint8Array);
      assert.equal(opts.body[0], part - 1, 'part offset must match its number');
      assert.equal(opts.body[opts.body.length - 1], 97);
      assert.equal(opts.headers?.Authorization, undefined, 'never send JWTs to Spaces');
      activeParts++;
      peakParts = Math.max(peakParts, activeParts);
      uploads.push(part);
      try {
        await tick();
        const status = options.partStatus ? await options.partStatus(part, uploads) : 200;
        if (status === 200) uploadedParts.add(part);
        return { ok: status === 200, status };
      } finally { activeParts--; }
    } },
    './api': { __esModule: true, default: api, BASE_URL: 'https://api.example' },
    './tokenRefresh': {
      async getValidAccessToken() { tokenCalls++; return options.token ? options.token(tokenCalls) : token; },
      async refreshAccessToken() { refreshCalls++; token = 'refreshed-token'; return { access: token }; },
    },
    './installationIdentity': { getInstallationId: async () => 'installation-1' },
    './mediaTransferPolicy': policy,
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, require: (name) => {
      assert.ok(name in adapters, `unexpected dependency ${name}`);
      return adapters[name];
    },
    Uint8Array, AbortController, Error, TypeError,
    setTimeout: (fn, ms) => setTimeout(fn, ms === policy.MEDIA_UPLOAD_TIMEOUT_MS ? ms : Math.min(ms, 2)),
    clearTimeout,
  });
  const params = { roomId: 'room-1', messageId: 'message-1', fileUri: 'file:///source.bin', mediaType: 'document', mime: 'application/octet-stream' };
  return {
    lane: module.exports, params, files, reads, uploads, apiCalls, nativeCalls, downloads, uploadedParts,
    downloadParams: { mediaId: 'media-1', mediaType: 'document', mime: 'application/pdf', md5: MD5, messageId: 'message-1', sizeBytes: size },
    stats: () => ({ openHandles, peakParts, activeParts, tokenCalls, refreshCalls }),
  };
}

for (const megabytes of [20, 100, 250]) {
  test(`${megabytes} MB multipart transfer reads bounded ranges and completes once`, async () => {
    const f = fixture({ size: megabytes * MB });
    const result = await f.lane.uploadMedia(f.params);
    assert.equal(result.media_id, 'media-1');
    assert.equal(f.reads.reduce((sum, r) => sum + r.length, 0), megabytes * MB);
    assert.equal(f.uploads.length, Math.ceil(megabytes / 8));
    assert.equal(f.apiCalls.filter((r) => r.url.endsWith('/complete/')).length, 1);
    assert.equal(f.stats().openHandles, 0);
    assert.equal(f.stats().peakParts, 2);
  });
}

test('concurrent retries share one initiation, upload, and completion', async () => {
  const f = fixture();
  const a = f.lane.uploadMedia(f.params);
  const b = f.lane.uploadMedia(f.params);
  assert.equal(a, b);
  await Promise.all([a, b, f.lane.uploadMedia(f.params)]);
  assert.equal(f.apiCalls.length, 2);
  assert.deepEqual(f.uploads, [1, 2, 3]);
});

test('failed parts drain before retry and resume skips completed parts', async () => {
  let rejectFirst = true;
  const f = fixture({ partStatus: (part) => part === 1 && rejectFirst ? 403 : 200 });
  await assert.rejects(f.lane.uploadMedia(f.params), (e) => e.failure.retryable && e.failure.status === 403);
  assert.equal(f.stats().activeParts, 0);
  assert.equal(f.stats().openHandles, 0);
  assert.equal(f.apiCalls.filter((r) => r.url.endsWith('/complete/')).length, 0);
  assert.deepEqual([...f.uploadedParts], [2]);
  rejectFirst = false;
  await f.lane.uploadMedia(f.params);
  assert.deepEqual(f.uploads, [1, 2, 1, 3]);
});

test('short native reads fail before PUT and always close the handle', async () => {
  const f = fixture({ shortRead: true });
  await assert.rejects(f.lane.uploadMedia(f.params), (e) => e.failure.code === 'invalid_file');
  assert.equal(f.stats().openHandles, 0);
  assert.equal(f.uploads.length, 0);
});

test('a resumed upload with every part present only completes the existing object', async () => {
  const f = fixture({ uploadedParts: [1, 2, 3] });
  await f.lane.uploadMedia(f.params);
  assert.equal(f.reads.length, 0);
  assert.equal(f.uploads.length, 0);
  assert.equal(f.apiCalls.filter((r) => r.url.endsWith('/complete/')).length, 1);
});

test('a transient storage failure retries the part without rereading the file', async () => {
  let attempts = 0;
  const f = fixture({ partStatus: (part) => part === 1 && ++attempts === 1 ? 503 : 200 });
  await f.lane.uploadMedia(f.params);
  assert.equal(f.uploads.filter((part) => part === 1).length, 2);
  assert.equal(f.reads.length, 3);
  assert.equal(f.stats().activeParts, 0);
});

test('single PUT is a native file upload, not a full-file JS Blob', async () => {
  const f = fixture({ size: 3 * MB, single: true });
  await f.lane.uploadMedia(f.params);
  assert.equal(f.nativeCalls.length, 1);
  assert.equal(f.nativeCalls[0].uri, 'file:///source.bin');
  assert.equal(f.nativeCalls[0].opts.uploadType, 0);
  assert.equal(f.nativeCalls[0].opts.headers.Authorization, undefined);
  assert.equal(f.reads.length, 0);
});

test('compatibility upload streams natively and refreshes once on 401', async () => {
  const f = fixture({
    initiateError: { response: { status: 409, data: { direct_upload: false } } },
    nativeUpload: (attempt) => ({ status: attempt === 1 ? 401 : 200, body: attempt === 1 ? '{}' : '{"media_id":"legacy-1"}' }),
  });
  assert.equal((await f.lane.uploadMedia(f.params)).media_id, 'legacy-1');
  assert.equal(f.stats().refreshCalls, 1);
  assert.equal(f.nativeCalls[1].opts.headers.Authorization, 'Bearer refreshed-token');
  assert.equal(f.nativeCalls[1].opts.uploadType, 1);
  assert.equal(f.nativeCalls[1].opts.parameters.message_id, f.params.messageId);
});

test('completion 404 cannot trigger a second full upload through the backend', async () => {
  const f = fixture({ single: true, completeError: { response: { status: 404 } } });
  await assert.rejects(f.lane.uploadMedia(f.params), (e) => e.failure.code === 'not_found');
  assert.equal(f.nativeCalls.length, 1);
});

for (const nativeMessage of ['response has status: 401', 'response has status 401']) {
  test(`download refreshes expired authentication (${nativeMessage})`, async () => {
    const f = fixture({ download: (attempt) => { if (attempt === 1) throw new Error(nativeMessage); } });
    const uri = await f.lane.downloadAndPersistMedia(f.downloadParams);
    assert.equal(f.stats().refreshCalls, 1);
    assert.deepEqual(f.downloads.map((d) => d.headers.Authorization), ['Bearer initial-token', 'Bearer refreshed-token']);
    assert.ok(f.downloads.every((d) => d.dest.endsWith('.partial')));
    assert.equal(uri, 'file:///documents/media/documents/message-1.pdf');
    assert.equal(f.files.has(uri), true);
    assert.equal([...f.files.keys()].some((key) => key.endsWith('.partial')), false);
  });
}

test('download reuses a token refreshed by another request', async () => {
  const f = fixture({ token: (attempt) => attempt === 1 ? 'old' : 'new', download: (attempt) => { if (attempt === 1) throw new Error('response has status: 401'); } });
  await f.lane.downloadAndPersistMedia(f.downloadParams);
  assert.equal(f.stats().refreshCalls, 0);
  assert.equal(f.downloads[1].headers.Authorization, 'Bearer new');
});

test('download retries 401 only once; 403 never refreshes', async () => {
  for (const status of [401, 403]) {
    const f = fixture({ download: () => { throw new Error(`response has status: ${status}`); } });
    await assert.rejects(f.lane.downloadAndPersistMedia(f.downloadParams), (e) => e.failure.status === status);
    assert.equal(f.downloads.length, status === 401 ? 2 : 1);
    assert.equal(f.stats().refreshCalls, status === 401 ? 1 : 0);
  }
});

test('incomplete downloads never become final files and failed partials are removed', async () => {
  for (const config of [{ downloadMd5: 'wrong' }, { downloadSize: 4 }, {
    download: (_attempt, { dest, files }) => {
      files.set(dest.uri, { size: 3, md5: 'partial' });
      throw new TypeError('Network request failed');
    },
  }]) {
    const f = fixture(config);
    await assert.rejects(f.lane.downloadAndPersistMedia(f.downloadParams), (e) => e.failure.retryable);
    assert.deepEqual([...f.files.keys()], ['file:///source.bin']);
  }
});

test('verified local attachments need no token or network request', async () => {
  const f = fixture();
  f.files.set('file:///documents/media/documents/message-1.pdf', { size: 20 * MB, md5: MD5 });
  await f.lane.downloadAndPersistMedia(f.downloadParams);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.stats().tokenCalls, 0);
});

test('missing and oversized attachments never initiate an upload', async () => {
  const missing = fixture();
  missing.files.clear();
  await assert.rejects(missing.lane.uploadMedia(missing.params), (e) => e.failure.code === 'invalid_file');
  const oversized = fixture({ size: 250 * MB + 1 });
  await assert.rejects(oversized.lane.uploadMedia(oversized.params), (e) => e.failure.code === 'too_large');
  assert.equal(missing.apiCalls.length + oversized.apiCalls.length, 0);
});
