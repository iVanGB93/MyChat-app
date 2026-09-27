const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/transports/p2pTextSession.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const drain = () => new Promise((resolve) => setImmediate(resolve));
const message = { id: 'stable-id', content: 'Hello', createdAt: '2026-09-27T12:00:00Z' };

test('mailbox negotiation uses a distinct channel and cannot downgrade into chat text', async () => {
  const f = fixture({ application: 'mailbox' }); await f.offer();
  assert.equal(f.channel.label, 'axonic-mailbox-v1');
  assert.match(f.signals[0].data.sdp, /a=x-axonic-mailbox:1/);
  await f.signal('answer'); assert.equal(f.pc.closed, true);
  const mailbox = fixture({ application: 'mailbox' });
  await mailbox.signal('offer', { data: { sdp: 'offer\r\na=x-axonic-mailbox:1\r\n' } });
  assert.equal(mailbox.pc.remoteDescription.sdp, 'offer\r\n');
  assert.match(mailbox.signals[0].data.sdp, /a=x-axonic-mailbox:1/);
  mailbox.channel.label = 'axonic-text-v1'; mailbox.remoteChannel();
  assert.equal(mailbox.channel.readyState, 'closed'); mailbox.close();
  const text = fixture();
  await text.signal('offer', { data: { sdp: 'offer\r\na=x-axonic-mailbox:1\r\n' } });
  assert.equal(text.pc.closed, true); assert.equal(text.saved.length, 0);
});

function fixture({ persist = async () => true, signalResult = true, hostOnly = false, application } = {}) {
  const timers = new Set(), signals = [], frames = [], saved = [], candidates = [];
  const pcEvents = {}, channelEvents = {};
  const label = application === 'mailbox' ? 'axonic-mailbox-v1' : 'axonic-text-v1';
  const channel = { label, protocol: label, readyState: 'connecting', bufferedAmount: 0,
    addEventListener: (event, fn) => { channelEvents[event] = fn; },
    send: (raw) => frames.push(JSON.parse(raw)), close() { this.readyState = 'closed'; } };
  const pc = { localDescription: null, connectionState: 'new', closed: false,
    addEventListener: (event, fn) => { pcEvents[event] = fn; },
    createDataChannel: () => channel,
    createOffer: async () => ({ type: 'offer', sdp: 'offer-sdp' }),
    createAnswer: async () => ({ type: 'answer', sdp: 'answer-sdp' }),
    async setLocalDescription(value) { this.localDescription = value; },
    async setRemoteDescription(value) { this.remoteDescription = value; },
    addIceCandidate: async (value) => candidates.push(value), close() { this.closed = true; } };
  const sandbox = { exports: {}, setTimeout: (fn, ms) => { const t = { fn, ms }; timers.add(t); return t; },
    clearTimeout: (t) => timers.delete(t) };
  vm.runInNewContext(code, sandbox);
  const session = sandbox.exports.createP2pTextSession({ hostOnly, application, roomId: 'room', sessionId: 'session', peerUserId: 14,
    createConnection: () => pc, sendSignal: (value) => { signals.push(value); return signalResult; },
    persistIncoming: async (value) => { saved.push(value); return persist(value); } });
  return { ...session, signals, frames, saved, candidates, timers, pc, channel,
    open() { channel.readyState = 'open'; channelEvents.open(); },
    receive(packet) { channelEvents.message({ data: JSON.stringify({ protocol: 1, session_id: 'session', room_id: 'room', ...packet }) }); },
    remoteChannel() { pcEvents.datachannel({ channel }); },
    localIce() { pcEvents.icecandidate({ candidate: { toJSON: () => ({ candidate: 'local' }) } }); },
    tick(ms) { for (const t of [...timers]) if (t.ms === ms) { timers.delete(t); t.fn(); } },
    signal(kind, extra = {}) { return session.handleSignal({ protocol: 1, room_id: 'room', session_id: 'session',
      signal_type: kind, from_user_id: 14, from_endpoint_id: 'peer-installation', data: { sdp: 'remote-sdp', candidate: 'remote' }, ...extra }); },
  };
}

test('direct text success waits for a matching storage receipt, not channel submission', async () => {
  const f = fixture(); await f.offer(); await f.signal('answer'); f.open(); f.receive({ type: 'ready' }); await drain();
  let completed = false;
  const delivery = f.send(message).then((value) => { completed = true; return value; });
  await drain(); assert.equal(completed, false);
  f.receive({ type: 'stored', id: 'other' }); await drain(); assert.equal(completed, false);
  f.receive({ type: 'stored', id: message.id, session_id: 'old' }); await drain(); assert.equal(completed, false);
  f.receive({ type: 'stored', id: message.id }); assert.equal(await delivery, true);
  assert.equal(f.frames[0].id, message.id);
  assert.equal(f.signals.some((s) => s.data.content), false, 'text never enters signaling');
  f.close(); assert.equal(f.timers.size, 0);
});

test('host-only offers require peer acknowledgement and strip preference before native SDP', async () => {
  const f = fixture({ hostOnly: true }); await f.offer();
  assert.match(f.signals[0].data.sdp, /a=x-axonic-host-only:1/);
  await f.signal('answer', { data: { sdp: 'answer-sdp\r\na=x-axonic-host-only:1\r\n' } });
  assert.equal(f.pc.remoteDescription.sdp, 'answer-sdp\r\n'); assert.equal(f.pc.closed, false);
  f.close();
  const old = fixture({ hostOnly: true }); await old.offer(); await old.signal('answer');
  assert.equal(old.pc.closed, true); assert.equal(old.timers.size, 0);
});

test('host-only answer acknowledges the preference without passing extension to native', async () => {
  const f = fixture({ hostOnly: true });
  await f.signal('offer', { data: { sdp: 'offer-sdp\r\na=x-axonic-host-only:1\r\n' } });
  assert.equal(f.pc.remoteDescription.sdp, 'offer-sdp\r\n');
  assert.match(f.signals[0].data.sdp, /a=x-axonic-host-only:1/); f.close();
});

test('receiver acknowledges only after persistence and never after a failed save', async () => {
  let finish;
  const f = fixture({ persist: () => new Promise((resolve) => { finish = resolve; }) });
  await f.signal('offer'); f.remoteChannel(); f.open(); assert.equal(f.frames.shift().type, 'ready');
  f.receive({ ...message, type: 'text' }); await drain(); assert.equal(f.frames.length, 0);
  finish(true); await drain(); assert.equal(f.frames[0].type, 'stored');
  f.receive({ ...message, id: 'failed', type: 'text' }); await drain(); finish(false); await drain();
  assert.equal(f.frames.length, 1); f.close();
});

test('Android remote channels with unavailable protocol metadata receive and acknowledge text', async () => {
  const f = fixture(); await f.signal('offer');
  f.channel.protocol = ''; f.remoteChannel(); f.open(); assert.equal(f.frames.shift().type, 'ready');
  f.receive({ ...message, type: 'text' }); await drain();
  assert.equal(f.saved.length, 1);
  assert.equal(f.frames[0].type, 'stored'); f.close();
});

test('an explicitly different channel protocol is rejected', async () => {
  const f = fixture(); await f.signal('offer');
  f.channel.protocol = 'another-protocol'; f.remoteChannel();
  assert.equal(f.channel.readyState, 'closed');
  assert.equal(f.saved.length, 0); f.close();
});

test('unavailable channel, backpressure, receipt timeout and close permit fallback', async () => {
  const f = fixture(); await f.offer();
  assert.equal(await f.send(message), false);
  await f.signal('answer'); f.open(); f.receive({ type: 'ready' }); await drain();
  f.channel.bufferedAmount = 100_000; assert.equal(await f.send(message), false);
  f.channel.bufferedAmount = 0;
  const timed = f.send(message); f.tick(2000); assert.equal(await timed, false);
  const retry = f.send(message); f.close(); assert.equal(await retry, false);
  assert.equal(f.frames[0].id, f.frames[1].id);
  assert.equal(f.pc.closed, true); assert.equal(f.timers.size, 0);
});

test('lost storage receipt times out; a late receipt cannot turn fallback into a second success', async () => {
  const sender = fixture(), receiver = fixture();
  await sender.offer(); await sender.signal('answer'); sender.open(); sender.receive({ type: 'ready' }); await drain();
  await receiver.signal('offer'); receiver.remoteChannel(); receiver.open(); assert.equal(receiver.frames.shift().type, 'ready');
  const result = sender.send(message);
  receiver.receive(sender.frames[0]); await drain();
  assert.equal(receiver.saved.length, 1);
  assert.equal(receiver.frames[0].type, 'stored');
  // Drop the receiver's receipt until after the sender's fallback deadline.
  sender.tick(2000); assert.equal(await result, false);
  sender.receive(receiver.frames[0]); await drain();
  assert.equal(await result, false);
  assert.equal(sender.frames.length, 1);
  sender.close(); receiver.close();
});

test('ICE before answer is buffered and competing installations cannot replace selected peer', async () => {
  const f = fixture(); await f.offer(); f.localIce();
  assert.equal(f.signals.length, 1);
  await f.signal('ice');
  await f.signal('ice', { from_endpoint_id: 'other-installation' });
  assert.equal(f.candidates.length, 0);
  await f.signal('answer');
  assert.equal(f.candidates.length, 1);
  assert.equal(f.signals[1].target_endpoint_id, 'peer-installation');
  await f.signal('close', { from_endpoint_id: 'other-installation' }); assert.equal(f.pc.closed, false);
  await f.signal('close'); assert.equal(f.pc.closed, true);
});

test('signals from another user, room or session cannot establish the connection', async () => {
  const f = fixture(); await f.offer();
  for (const extra of [{ from_user_id: 77 }, { room_id: 'other' }, { session_id: 'old' }, { protocol: 2 }]) {
    await f.signal('answer', extra);
    assert.equal(f.pc.remoteDescription, undefined);
  }
  f.tick(10_000); assert.equal(f.pc.closed, true); assert.equal(f.timers.size, 0);
});

test('closed session cannot acknowledge an in-flight save or resume negotiation', async () => {
  let finish;
  const f = fixture({ persist: () => new Promise((resolve) => { finish = resolve; }) });
  await f.signal('offer'); f.remoteChannel(); f.open(); assert.equal(f.frames.shift().type, 'ready');
  f.receive({ ...message, type: 'text' }); await drain();
  f.close(); finish(true); await drain();
  assert.equal(f.frames.length, 0); assert.equal(await f.offer(), false);
});

test('malformed and oversized packets never reach storage', async () => {
  const f = fixture(); await f.offer(); await f.signal('answer'); f.open(); f.receive({ type: 'ready' }); await drain();
  for (const packet of [{ ...message, type: 'text', room_id: 'other' },
    { ...message, type: 'text', content: 'x'.repeat(17000) },
    { ...message, type: 'text', createdAt: 'not-a-date' }]) f.receive(packet);
  await drain(); assert.equal(f.saved.length, 0); assert.equal(f.frames.length, 0);
  assert.equal(await f.send({ ...message, content: 'x'.repeat(17000) }), false);
  f.close();
});

test('failed signaling and maximum session lifetime release the peer', async () => {
  const failed = fixture({ signalResult: false });
  assert.equal(await failed.offer(), false); assert.equal(failed.pc.closed, true);
  const f = fixture(); await f.offer(); await f.signal('answer'); f.open(); f.receive({ type: 'ready' }); await drain();
  f.tick(300_000); assert.equal(f.pc.closed, true); assert.equal(f.timers.size, 0);
});

test('activity renews the idle window but not the maximum authorization lease', async () => {
  const f = fixture(); await f.offer(); await f.signal('answer'); f.open(); f.receive({ type: 'ready' }); await drain();
  const idle = [...f.timers].find(t => t.ms === 60_000);
  const lease = [...f.timers].find(t => t.ms === 300_000);
  const sending = f.send(message);
  f.receive({ type: 'stored', id: message.id }); assert.equal(await sending, true);
  assert.equal(f.timers.has(idle), false); assert.equal(f.timers.has(lease), true);
  f.tick(60_000); assert.equal(f.isReady(), false); assert.equal(f.timers.size, 0);
});

test('local open waits for the remote listener; wrong-room readiness cannot release text', async () => {
  const f = fixture(); await f.offer(); await f.signal('answer'); f.open();
  let completed = false;
  const ready = f.waitUntilOpen().then(value => { completed = true; return value; });
  assert.equal(await f.send(message), false);
  f.receive({ type: 'ready', room_id: 'another-room' }); await drain();
  assert.equal(completed, false); assert.equal(f.frames.length, 0);
  f.receive({ type: 'ready' }); assert.equal(await ready, true);
  const delivery = f.send(message);
  assert.equal(f.frames[0].type, 'text');
  f.receive({ type: 'stored', id: message.id }); assert.equal(await delivery, true);
  f.close();
});

test('missing readiness has a bounded fallback and sends no text', async () => {
  const f = fixture(); await f.offer(); await f.signal('answer'); f.open();
  const ready = f.waitUntilOpen(); f.tick(3000);
  assert.equal(await ready, false); assert.equal(await f.send(message), false);
  assert.equal(f.frames.length, 0); f.close(); assert.equal(f.timers.size, 0);
});

test('already-open remote channel announces readiness after attaching the message listener, once', async () => {
  const f = fixture(); await f.signal('offer');
  f.channel.readyState = 'open'; f.remoteChannel();
  assert.equal(f.frames[0].type, 'ready');
  f.open(); assert.equal(f.frames.length, 1);
  f.receive({ ...message, type: 'text' }); await drain();
  assert.equal(f.frames[1].type, 'stored'); f.close();
});

test('readiness arriving before the local open event waits for both conditions', async () => {
  const f = fixture(); await f.offer(); await f.signal('answer');
  let completed = false;
  const ready = f.waitUntilOpen().then(value => { completed = true; return value; });
  f.receive({ type: 'ready' }); await drain(); assert.equal(completed, false);
  f.open(); assert.equal(await ready, true); f.close();
});
