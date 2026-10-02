import { createIntroductionService, verifyIntroductions, type IntroductionHooks } from './identityIntroductions.ts';
import { createIdentityExchange } from './identityExchange.ts';
import { createAxonTestMessages, createAxonNormalMessages, type TestMessageHandler } from './axonTestMessages.ts';
import { bytesToHex } from '@noble/hashes/utils.js';
import { authenticateIdentityPeer, type IdentityPeer } from './identityClient.ts';
import { signIdentityRequest, type IdentityRecordStore } from './identityAdmission.ts';
import { validAccountId, publicDevice, type IdentityRecord } from './identityProtocol.ts';
import type { NeuronLink } from './neuronConnections.ts';

export const AXON_FRAME_BYTES = 20_000;
export interface AxonWire {
  send(raw: string): void;
  close(): void;
  listen(message: (raw: string) => void, closed: () => void): () => void;
}
/** Symmetric, connection-bound identity/liveness protocol. Optional introductions and opt-in test messages.
 * Caller supplies a NEW secure instance nonce for EACH socket and calls tick() every second.
 * The wire adapter must bound inbound frames before buffering and outbound queued bytes.
 * Stop before locking/replacing keys. Authentication does not imply conversation access.
 */
export function createPersistentAxon(d: {
  record: IdentityRecord; history?: IdentityRecord[]; signingSeed: Uint8Array; instance: Uint8Array; store: IdentityRecordStore;
  onCustody?(raw: string, peer: IdentityPeer): Promise<string>;
  onSignal?(raw: string, peer: IdentityPeer): Promise<boolean>;
  testMessages?: { encryptionSeed: Uint8Array; received: TestMessageHandler };
  chatMessages?: { encryptionSeed: Uint8Array; received: TestMessageHandler };
  expectedAccount?: string; introductions?: IntroductionHooks; wire: AxonWire; now(): number; current(): boolean;
  random(size: number): Promise<Uint8Array>; onClosed(): void;
}) {
  let stopped = false, remote: string | null = null, peer: IdentityPeer | null = null;
  let peerTests = false, peerCustody = false, peerChat = false;
  const chat = d.chatMessages ? createAxonNormalMessages({
    local: { account: d.record.account, device: publicDevice(d.signingSeed, d.chatMessages.encryptionSeed).id, instance: bytesToHex(d.instance) },
    encryptionSeed: d.chatMessages.encryptionSeed, peer: () => peer, store: d.store, now: d.now, random: d.random,
    current: () => !stopped && peerChat && d.current(), received: d.chatMessages.received,
    send: body => send({ version: 1, kind: 'chat-message', body }),
  }) : null;
  const tests = d.testMessages ? createAxonTestMessages({
    local: { account: d.record.account, device: publicDevice(d.signingSeed, d.testMessages.encryptionSeed).id, instance: bytesToHex(d.instance) },
    encryptionSeed: d.testMessages.encryptionSeed, peer: () => peer, store: d.store, now: d.now, random: d.random,
    current: () => !stopped && peerTests && d.current(), received: d.testMessages.received,
    send: body => send({ version: 1, kind: 'test-message', body }),
  }) : null;
  let peerSignals = false, signalBusy = false, signalWindow = d.now(), signalCount = 0;
  let peerIntroductions = false, introducing = false, introduceAt = d.now() + 5000;
  let authenticating = false, renewalAt = 0, inboundBusy = false, sequence = 0;
  let custodyWaiting = 0;
  let windowAt = d.now(), frames = 0;
  const started = d.now();
  let pending: { id: number; resolve(raw: string): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  let resolveReady!: (link: NeuronLink) => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<NeuronLink>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Consumers may attach after opening; avoid a transient unhandled rejection on early close.
  void ready.catch(() => {});
  const service = createIdentityExchange({ ...d, current: () => !stopped && d.current() });
  const introduce = d.introductions ? createIntroductionService({ ...d, peer: () => peer,
    current: () => !stopped && d.current(), list: d.introductions.list }) : null;
  let unsubscribe = () => {};
  function stop() {
    if (stopped) return;
    stopped = true;
    tests?.stop();
    chat?.stop();
    try { unsubscribe(); } catch { /* Cleanup must continue even if an adapter fails. */ }
    if (pending) { clearTimeout(pending.timer); pending.reject(Error('Axon closed')); pending = null; }
    rejectReady(Error('Axon closed'));
    try { d.wire.close(); } catch { /* The session is already closed. */ }
    try { d.onClosed(); } catch { /* Observer failures cannot retain authentication. */ }
  }
  function send(frame: unknown) {
    if (stopped || !d.current()) throw Error('Axon unavailable');
    const raw = JSON.stringify(frame);
    if (new TextEncoder().encode(raw).length > AXON_FRAME_BYTES) throw Error('Axon frame too large');
    d.wire.send(raw);
  }
  function exchange(operation: 'describe' | 'authenticate' | 'introductions' | 'custody', body: string): Promise<string> {
    if (pending || stopped) return Promise.reject(Error('Axon exchange unavailable'));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending = { id, resolve, reject, timer: setTimeout(stop, 4000) };
      try { send({ version: 1, kind: 'request', id, operation, body }); }
      catch { stop(); }
    });
  }
  async function authenticate() {
    if (!remote || authenticating || introducing || pending || stopped) return;
    authenticating = true;
    try {
      const result = await authenticateIdentityPeer({ localAccount: d.record.account, expectedAccount: remote,
        store: d.store, now: d.now, random: d.random, current: () => !stopped && d.current(), exchange,
        sign: async audience => signIdentityRequest(d.record, d.signingSeed, audience, 'authenticate', '', await d.random(32), d.now(), d.history) });
      if (!result || stopped || (peer && (peer.account !== result.account || peer.device !== result.device || peer.instance !== result.instance))) { stop(); return; }
      if (peer) peer.expiresAt = result.expiresAt;
      else { peer = { ...result }; resolveReady({ peer, close: stop }); }
      renewalAt = d.now() + 20_000;
    } catch { stop(); }
    finally { authenticating = false; }
  }
  async function discover() {
    const source = peer;
    if (!source || !d.introductions || !peerIntroductions || introducing || authenticating || pending || stopped) return;
    introducing = true; introduceAt = d.now() + 15_000;
    try {
      const nonce = await d.random(32);
      if (stopped || !d.current() || source.expiresAt <= d.now()) return;
      const request = JSON.stringify(signIdentityRequest(d.record, d.signingSeed,
        { account: source.account, instance: source.instance }, 'lookup', 'introductions-v1', nonce, d.now(), d.history));
      const reply = await exchange('introductions', request);
      const record = await d.store.read(source.account);
      if (stopped || !d.current()) return;
      const peers = record ? verifyIntroductions(reply, request, source, record, d.now()) : null;
      if (!peers) { stop(); return; }
      d.introductions.received(peers);
    } catch { stop(); }
    finally { introducing = false; }
  }
  async function receive(raw: string) {
    try {
      if (stopped) return;
      if (!d.current() || typeof raw !== 'string' || new TextEncoder().encode(raw).length > AXON_FRAME_BYTES) { stop(); return; }
      if (d.now() - windowAt >= 60_000) { windowAt = d.now(); frames = 0; }
      if (++frames > 64) { stop(); return; }
      const f = JSON.parse(raw);
      if (f.version !== 1) { stop(); return; }
      if (f.kind === 'hello') {
        if (remote || !validAccountId(f.account) || f.account === d.record.account || (d.expectedAccount && f.account !== d.expectedAccount)) { stop(); return; }
        peerSignals = Array.isArray(f.features) && f.features.length <= 8 && f.features.includes('rtc-signals-v1');
        peerCustody = Array.isArray(f.features) && f.features.length <= 8 && f.features.includes('custody-v1');
        peerTests = Array.isArray(f.features) && f.features.length <= 8 && f.features.includes('test-messages-v2');
        peerChat = Array.isArray(f.features) && f.features.length <= 8 && f.features.includes('chat-text-v1');
        peerIntroductions = Array.isArray(f.features) && f.features.length <= 8 && f.features.includes('introductions-v1');
        remote = f.account; void authenticate(); return;
      }
      if (f.kind === 'signal') {
        if (!peer || peer.expiresAt <= d.now() || !peerSignals || !d.onSignal || signalBusy || typeof f.body !== 'string') { stop(); return; }
        if (d.now() - signalWindow >= 60000) { signalWindow = d.now(); signalCount = 0; }
        if (++signalCount > 16) { stop(); return; }
        signalBusy = true;
        try { await d.onSignal(f.body, peer); } finally { signalBusy = false; }
        return;
      }
      if (f.kind === 'test-message') {
        if (!tests || !peerTests || !peer || peer.expiresAt <= d.now() || !await tests.receive(f.body)) stop();
        return;
      }
      if (f.kind === 'chat-message') {
        if (!chat || !peerChat || !peer || peer.expiresAt <= d.now() || !await chat.receive(f.body)) stop();
        return;
      }
      if (!remote || !Number.isSafeInteger(f.id) || f.id < 1 || typeof f.body !== 'string' || f.body.length > 16000) { stop(); return; }
      if (f.kind === 'response') {
        if (!pending || pending.id !== f.id) { stop(); return; }
        const task = pending; pending = null; clearTimeout(task.timer); task.resolve(f.body); return;
      }
      if (f.kind !== 'request' || inboundBusy) { stop(); return; }
      inboundBusy = true;
      try {
        let response: string | null = null;
        if (f.operation === 'describe') {
          const body = JSON.parse(f.body);
          if (body?.version === 1 && typeof body.nonce === 'string') response = service.describe(body.nonce);
        } else if (f.operation === 'authenticate') {
          const body = JSON.parse(f.body);
          if (body?.record?.account === remote) response = await service.authenticate(f.body);
        }
        if (f.operation === 'custody' && d.onCustody && peer && peer.expiresAt > d.now()) response = await d.onCustody(f.body, peer);
        if (f.operation === 'introductions' && introduce && peerIntroductions) response = await introduce(f.body);
        if (!response || stopped || !d.current()) { stop(); return; }
        send({ version: 1, kind: 'response', id: f.id, body: response });
      } finally { inboundBusy = false; }
    } catch { stop(); }
  }
  try {
    unsubscribe = d.wire.listen(raw => { void receive(raw); }, stop);
    // An adapter may report an already-closed wire while registering callbacks.
    if (stopped) { try { unsubscribe(); } catch { /* Best-effort cleanup. */ } }
  } catch { stop(); }
  const deadline = setTimeout(() => { if (!peer) stop(); }, 10_000);
  void ready.then(() => clearTimeout(deadline), () => clearTimeout(deadline));
  try { send({ version: 1, kind: 'hello', account: d.record.account, features: [...(d.onCustody ? ['custody-v1'] : []), ...(d.introductions ? ['introductions-v1'] : []), ...(d.onSignal ? ['rtc-signals-v1'] : []), ...(tests ? ['test-messages-v2'] : []), ...(chat ? ['chat-text-v1'] : [])] }); } catch { stop(); }
  return {
    ready, stop,
    supportsCustody: () => peerCustody && !!peer && !stopped && d.current() && peer.expiresAt > d.now(),
    async custodyRequest(raw: string): Promise<string | null> {
      const permitted = () => !!peer && peer.expiresAt > d.now() && peerCustody && !stopped && d.current();
      if (!permitted() || raw.length > 8000 || custodyWaiting >= 2) return null;
      custodyWaiting++;
      try {
        // Bounded local contention must not immediately mark a healthy relay unavailable.
        // Use a bounded number of waits so clock changes cannot prolong the queue.
        for (let waits = 0; permitted() && (authenticating || introducing || pending) && waits < 80; waits++)
          await new Promise(resolve => setTimeout(resolve, 25));
        if (!permitted() || authenticating || introducing || pending) return null;
        const result = await exchange('custody', raw);
        return permitted() ? result : null;
      } catch { return null; }
      finally { custodyWaiting--; }
    },
    sendTestMessage: (text: string, id?: string) => tests?.send(text, id) ?? Promise.resolve(false),
    sendChatMessage: (text: string, id: string) => chat?.send(text, id) ?? Promise.resolve(false),
    sendSignal(raw: string) {
      if (!peer || peer.expiresAt <= d.now() || !peerSignals || !d.onSignal || stopped || !d.current()) return false;
      try { send({ version: 1, kind: 'signal', body: raw }); return true; } catch { stop(); return false; }
    },
    tick() {
      if (stopped) return;
      if (!d.current() || (!peer && d.now() - started >= 10_000) || (peer && peer.expiresAt <= d.now())) { stop(); return; }
      if (peer && d.now() >= renewalAt) void authenticate();
      else if (peer && d.now() >= introduceAt) void discover();
    },
    snapshot: () => ({ state: stopped ? 'closed' : peer ? 'connected' : 'authenticating',
      account: peer?.account ?? null, expiresAt: peer?.expiresAt ?? null }),
  };
}
