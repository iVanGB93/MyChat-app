const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the real FCM -> push store -> ingress -> persistent receipt queue
// promise chain. Only native storage, network, notifications and UI are mocked.
const compiled = new Map();
function compile(name) {
  if (!compiled.has(name)) compiled.set(name, ts.transpileModule(
    fs.readFileSync(path.join(__dirname, `../src/services/${name}.ts`), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } },
  ).outputText);
  return compiled.get(name);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const drain = () => new Promise((resolve) => setTimeout(resolve, 30));
const accepted = () => ({ status: 200, data: { status: 'delivered' } });
const message = (type = 'voice', id = 'voice-1') => ({
  type: 'new_message', message_id: id, room_id: 'private-room', sender_id: '18',
  sender: 'Test sender', content: 'Voice message', message_type: type,
  media_id: `blob-${id}`, media_mime: 'audio/m4a', media_size: '2000',
});

function fixture(options = {}) {
  const rows = options.rows ?? new Map();
  const storage = options.storage ?? new Map();
  const events = [], requests = [], downloads = [], injections = [], notifications = [];
  let background, foreground, unread = 0, now = 100000;
  const controls = {
    download: async (args) => `file://durable/${args.messageId}`,
    post: async () => accepted(),
    save: async () => {},
    display: async () => {},
    ...options.controls,
  };
  const state = {
    user: { id: 14 }, blockedIds: {}, mutedRooms: {}, contactIds: { 18: true }, activeRoomId: null,
    setRoomLastMessage: () => events.push('preview'),
    incrementRoomUnread: () => { unread++; },
  };
  const adapters = {
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => { storage.set(key, value); },
      removeItem: async (key) => { storage.delete(key); },
    },
    './api': { post: async (url, data) => {
      requests.push({ url, data }); events.push('ack-start');
      return controls.post(url, data);
    }, resolveMediaUrl: (url) => url },
    './diagnostics': { debugLog() {} },
    '../store/appStore': { useAppStore: { getState: () => state } },
    './localMessageStore': {
      messageExists: async (id) => rows.has(id),
      saveMessage: async (row) => {
        await controls.save(row);
        rows.set(row.id, { ...row }); events.push('saved');
      },
      getMessageFileUri: async (id) => rows.get(id)?.file_uri ?? null,
      isMessageMediaEvicted: async (id) => rows.get(id)?.media_evicted === 1,
      setMessageFileUri: async (id, uri) => { rows.get(id).file_uri = uri; events.push('file-saved'); },
      getIncompletePointerMedia: async (roomId) => [...rows.values()]
        .filter((row) => !row.file_uri && row.media_ptr && (!roomId || row.room_id === roomId))
        .map((row) => ({ ...row, media_ptr: JSON.stringify(row.media_ptr), reply_to: null })),
    },
    './chatWsManager': { injectReceivedMessage: (room, msg, opts) => injections.push({ room, msg, opts }) },
    './notificationPresentationPolicy': { decideLocalMessageNotification: () => ({ allow: false }) },
    './rrp/envelope': {},
    './presenceService': {},
    './mediaLane': {
      downloadAndPersistMedia: async (args) => { downloads.push(args); return controls.download(args); },
      confirmDownloaded: async () => { events.push('confirmed'); },
    },
    './voiceMessageUtils': {
      saveIncomingAudio: async (id) => `file://inline/${id}`,
      saveIncomingImage: async (id) => `file://inline/${id}`,
    },
    './messageNotificationService': {
      ensureMessageChannel: async () => {},
      parseMessageNotifData: (data) => data,
      displayMessageNotification: async (data) => {
        notifications.push(data); await controls.display(data);
      },
    },
    './mediaConfirmationQueue': {
      flushPendingMediaConfirmations: async () => ({ flushed: 0, failed: 0 }),
    },
    '@react-native-firebase/messaging': {
      getMessaging: () => ({}),
      setBackgroundMessageHandler: (_, handler) => { background = handler; },
      onMessage: (_, handler) => { foreground = handler; return () => {}; },
    },
    'react-native': { Platform: { OS: 'android' } },
  };
  function load(name) {
    const key = `./${name}`;
    if (adapters[key]) return adapters[key];
    const sandbox = {
      exports: {}, console: { warn() {} },
      setTimeout(fn, ms) { if (ms < 100) return setTimeout(fn, ms); },
      Date: class extends Date { static now() { return now; } },
      require(dep) {
        if (dep in adapters) return adapters[dep];
        assert.ok(['./messageAckRetryQueue', './messageAckTransport', './ingressRouter', './pushMessageStore'].includes(dep), `Unexpected dependency: ${dep}`);
        return load(dep.slice(2));
      },
    };
    vm.runInNewContext(compile(name), sandbox);
    adapters[key] = sandbox.exports;
    return sandbox.exports;
  }
  const router = load('ingressRouter'), queue = load('messageAckRetryQueue'), fcm = load('fcmService');
  fcm.registerFcmBackgroundHandler();
  fcm.registerFcmForegroundHandler();
  return {
    ...router, queue, rows, storage, controls, state, events, requests, downloads, injections, notifications,
    receive: (data, extra = {}) => background({ data, ...extra }),
    foreground: (data) => foreground({ data }),
    advance: (ms) => { now += ms; },
    get unread() { return unread; },
  };
}

for (const type of ['voice', 'image', 'video', 'document']) {
  test(`${type}: background task awaits verified bytes AND the delivery receipt, with a prompt notification`, async () => {
    const download = deferred(), ack = deferred();
    const app = fixture({ controls: { download: () => download.promise, post: () => ack.promise } });
    let finished = false;
    const task = app.receive(message(type)).then(() => { finished = true; });
    await drain();
    assert.equal(app.notifications.length, 1);
    assert.equal(app.downloads.length, 1);
    assert.equal(app.rows.get('voice-1').file_uri, null);
    assert.equal(app.unread, 1);
    assert.equal(app.requests.length, 0, 'placeholder must not acknowledge media');
    assert.equal(finished, false);
    download.resolve('file://durable/voice-1');
    await drain();
    assert.equal(app.rows.get('voice-1').file_uri, 'file://durable/voice-1');
    assert.equal(app.requests.length, 1);
    assert.equal((await app.queue.getQueueStatus()).length, 1);
    assert.equal(finished, false, 'HTTP receipt must remain part of the headless task');
    ack.resolve(accepted());
    await task;
    assert.equal(finished, true);
    assert.equal((await app.queue.getQueueStatus()).length, 0);
    assert.ok(app.events.indexOf('file-saved') < app.events.indexOf('ack-start'));
    assert.ok(app.events.includes('confirmed'));
  });
}

test('concurrent push/WS/recovery share one download, persist once and increment unread once', async () => {
  const download = deferred();
  const app = fixture({ controls: { download: () => download.promise } });
  const tasks = [app.ingestMessage(message(), 'ws'), app.receive(message())];
  await drain();
  let recovered = false;
  tasks.push(app.retryPointerDownloads().then(() => { recovered = true; }));
  await drain();
  assert.equal(recovered, false, 'recovery must join, not detach from, the active download');
  download.resolve('file://durable/voice-1');
  await Promise.all(tasks);
  assert.equal(app.downloads.length, 1);
  assert.equal(app.events.filter((event) => event === 'saved').length, 1);
  assert.equal(app.unread, 1);
  assert.equal(app.requests.length, 1);
});

test('interrupted download survives a process restart and retries without opening a chat', async () => {
  const app = fixture({ controls: { download: async () => { throw Error('connection lost'); } } });
  await app.receive(message());
  assert.equal(app.requests.length, 0);
  assert.equal(app.rows.get('voice-1').file_uri, null);
  const restarted = fixture({ rows: app.rows, storage: app.storage });
  await restarted.retryPointerDownloads();
  assert.equal(restarted.rows.get('voice-1').file_uri, 'file://durable/voice-1');
  assert.equal(restarted.requests.length, 1);
  assert.equal(restarted.unread, 0);
  assert.equal(restarted.notifications.length, 0);
});

test('failed receipt remains durable; duplicate retries without redownloading or double unread', async () => {
  const app = fixture({ controls: { post: async () => { throw Error('offline'); } } });
  await app.receive(message());
  assert.equal((await app.queue.getQueueStatus()).length, 1);
  app.controls.post = async () => accepted();
  await app.ingestMessage(message(), 'ws');
  assert.equal(app.requests.length, 3, 'headless recovery retries once before a later duplicate');
  assert.equal(app.downloads.length, 1);
  assert.equal(app.unread, 1);
  assert.equal((await app.queue.getQueueStatus()).length, 0);
  assert.equal(app.injections.at(-1).opts.updateExisting, false, 'duplicate must not overwrite an edited bubble');
});

test('HTTP 200 not_found is retried durably after restart, not treated as delivery', async () => {
  const app = fixture({ controls: { post: async () => ({ status: 200, data: { status: 'not_found' } }) } });
  await app.receive(message());
  assert.equal((await app.queue.getQueueStatus()).length, 1);
  app.advance(2000);
  const first = await app.queue.flushPendingAcks();
  assert.equal(first.failed, 1);
  assert.equal(first.flushed, 0);
  const restarted = fixture({ rows: app.rows, storage: app.storage });
  restarted.advance(5000);
  assert.equal((await restarted.queue.flushPendingAcks()).flushed, 1);
  assert.equal((await restarted.queue.getQueueStatus()).length, 0);
});

test('a richer inline duplicate repairs a stripped push instead of being stuck in the persist guard', async () => {
  const app = fixture();
  const stripped = { ...message(), media_id: undefined };
  await Promise.all([
    app.ingestMessage(stripped, 'push_receive'),
    app.ingestMessage({ ...stripped, audio_b64: 'dm9pY2U=' }, 'ws'),
  ]);
  assert.equal(app.rows.get('voice-1').file_uri, 'file://inline/voice-1');
  assert.equal(app.requests.length, 1);
  assert.equal(app.unread, 1);
  assert.equal(app.injections.at(-1).opts.updateExisting, true);
});

test('failed SQLite persistence releases the per-message guard for the next delivery', async () => {
  const app = fixture({ controls: { save: async () => { throw Error('database busy'); } } });
  await assert.rejects(app.ingestMessage(message(), 'ws'), /database busy/);
  assert.equal(app.requests.length, 0);
  app.controls.save = async () => {};
  await app.receive(message());
  assert.equal(app.rows.size, 1);
  assert.equal(app.requests.length, 1);
});

test('legacy notification payload and notification-render errors still await receive completion', async () => {
  for (const legacy of [true, false]) {
    const download = deferred();
    const app = fixture({ controls: { download: () => download.promise, display: async () => { throw Error('notifications disabled'); } } });
    let finished = false;
    const task = app.receive(message(), legacy ? { notification: { title: 'Legacy' } } : {})
      .then(() => { finished = true; });
    await drain();
    assert.equal(finished, false);
    assert.equal(app.notifications.length, legacy ? 0 : 1);
    download.resolve('file://durable/voice-1');
    await task;
    assert.equal(app.requests.length, 1);
  }
});

test('text foreground delivery awaits its receipt without adding a push notification', async () => {
  const ack = deferred();
  const app = fixture({ controls: { post: () => ack.promise } });
  let finished = false;
  const task = app.foreground({ ...message('text'), media_id: undefined }).then(() => { finished = true; });
  await drain();
  assert.equal(finished, false);
  assert.equal(app.rows.size, 1);
  assert.equal(app.notifications.length, 0);
  ack.resolve(accepted());
  await task;
});

test('own echoes and blocked senders never acknowledge delivery', async () => {
  const app = fixture();
  app.state.blockedIds[99] = true;
  await app.ingestMessage({ ...message(), sender_id: '14' }, 'ws');
  await app.ingestMessage({ ...message(), sender_id: '99' }, 'ws');
  assert.equal(app.requests.length, 0);
  assert.equal(app.rows.size, 0);
});

test('successful receipt removal preserves concurrent enqueues and other sender/room identities', async () => {
  const app = fixture();
  const ack = { message_id: 'same-id', room_id: 'room-a', sender_id: 18 };
  await app.queue.enqueueMessageAck(ack);
  await Promise.all([
    app.queue.removeMessageAck(ack.message_id, ack.sender_id, ack.room_id),
    app.queue.enqueueMessageAck({ ...ack, room_id: 'room-b' }),
    app.queue.enqueueMessageAck({ ...ack, sender_id: 19 }),
    app.queue.enqueueMessageAck({ ...ack, message_id: 'new-id' }),
  ]);
  const pending = await app.queue.getQueueStatus();
  assert.equal(pending.length, 3);
  assert.ok(!pending.some((item) => item.message_id === ack.message_id && item.room_id === ack.room_id && item.sender_id === ack.sender_id));
});
