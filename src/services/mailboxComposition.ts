import Native from '../../modules/axonic-nearby';
import { useAppStore } from '../store/appStore';
import { getCachedRooms, getMessagesByIds } from './localMessageStore';
import { ingestMessage } from './ingressRouter';
import { isNotifWsReady, sendRawNotif, subscribeStatus } from './notificationWsManager';
import { createP2pTextRuntime } from './transports/p2pTextRuntime';
import { createNativeTextPeer } from './transports/nativeTextPeer';
import { MAILBOX_ENABLED, configureMailboxTextAttempt, acceptMailboxDelivered } from './transports/p2pTextBridge';
import { createMailboxNode, type MailboxIdentity, type MailboxCrypto } from './transports/mailboxProtocol';
import { mailboxStore, pinMailboxIdentities, getMailboxOutgoing, bindMailboxOutgoing, markMailboxCustody } from './transports/mailboxStore';
import { createMailboxOutbox } from './transports/mailboxOutbox';
import type { OutgoingTextMessage, TextDeliveryOptions } from './transports/textTransport';
import type { MailboxTextResult } from './transports/p2pTextBridge';
import { createNeuronClient, type NeuronEndpoint } from './transports/neuronExchange';
import { readMailboxConfiguration, writeMailboxConfiguration } from './transports/mailboxStore';
import { createNeuronSignaling } from './transports/neuronSignaling';

export interface MailboxPair extends MailboxIdentity { user: number; roomId?: string }
let active: { owner: number; stop(): void; signal(payload: Record<string, any>): Promise<void>;
  attempt(message: OutgoingTextMessage, options?: TextDeliveryOptions): Promise<MailboxTextResult | null> } | null = null;
let generation = 0;
let configurationRevision = 0;
let configurationChanges = 0;
let restoring: { owner: number; promise: Promise<void> } | null = null;
let recoverySubscription: (() => void) | null = null;
let recoveryError: string | null = null;
let discoveredPeers: number[] = [];
let signalingStatus: (() => unknown) | null = null;
let directStored = 0;
let directPackets: string[] = [];
const supported = () => MAILBOX_ENABLED && !!Native?.mailboxIdentity && !!Native?.mailboxDigest
  && !!Native?.mailboxSign && !!Native?.mailboxVerify && !!Native?.mailboxSeal && !!Native?.mailboxOpen;
export async function mailboxPublicIdentity(): Promise<MailboxPair> {
  const owner = useAppStore.getState().user?.id;
  if (!owner || !supported()) throw new Error('Mailbox requires the updated Android development build');
  const identity = await Native!.mailboxIdentity!(owner);
  if (useAppStore.getState().user?.id !== owner) throw new Error('Account changed');
  return { user: owner, ...identity };
}
export function stopMailboxPrototype() { generation++; active?.stop(); active = null; discoveredPeers = []; signalingStatus = null; directStored = 0; directPackets = []; }
export async function routeMailboxSignal(payload: Record<string, any>) { await active?.signal(payload); }

/** Explicitly approve and remember public peer routes on this device/account. */
export async function rememberMailboxPairing(pairs: MailboxPair[], neuron?: NeuronEndpoint) {
  const owner = useAppStore.getState().user?.id;
  if (!owner) throw new Error('Sign in before saving mailbox pairing');
  const revision = ++configurationRevision;
  const snapshot = JSON.parse(JSON.stringify({ version: 1, owner, pairs, neuron }));
  configurationChanges++;
  try {
    const node = await startMailboxPrototype(snapshot.pairs, snapshot.neuron);
    const epoch = generation;
    const current = () => generation === epoch && configurationRevision === revision && useAppStore.getState().user?.id === owner;
    try {
      await writeMailboxConfiguration(owner, snapshot, current);
      if (!current()) throw new Error('Mailbox pairing was interrupted');
      recoveryError = null;
      return node;
    } catch (error) { node.stop(); throw error; }
  } finally {
    configurationChanges--;
    if (recoverySubscription && useAppStore.getState().user?.id !== owner) void restoreMailboxPairing();
  }
}

/** Disable remembered participation without removing immutable pins or pending messages. */
export async function forgetMailboxPairing() {
  const owner = useAppStore.getState().user?.id;
  const revision = ++configurationRevision;
  configurationChanges++;
  stopMailboxPrototype();
  try {
    if (owner) await writeMailboxConfiguration(owner, null, () => configurationRevision === revision);
    recoveryError = null;
  } finally {
    configurationChanges--;
    if (recoverySubscription && useAppStore.getState().user?.id !== owner) void restoreMailboxPairing();
  }
}

export function mailboxSessionStatus() {
  return { owner: active?.owner ?? null, restoring: restoring !== null, error: recoveryError, discovered: [...discoveredPeers],
    signaling: signalingStatus?.() ?? null, directStored, directPackets: [...directPackets] };
}

export function restoreMailboxPairing(): Promise<void> {
  const state = useAppStore.getState(), owner = state.user?.id;
  if (!owner || !supported() || state.appLifecycle !== 'active' || state.activeCall || active || configurationChanges) return Promise.resolve();
  if (restoring?.owner === owner) return restoring.promise;
  const epoch = generation, revision = configurationRevision;
  const current = () => generation === epoch && configurationRevision === revision
    && useAppStore.getState().user?.id === owner && useAppStore.getState().appLifecycle === 'active' && !useAppStore.getState().activeCall;
  const job = { owner, promise: Promise.resolve() };
  job.promise = (async () => {
    try {
      const saved = await readMailboxConfiguration(owner) as { version?: number; owner?: number; pairs?: MailboxPair[]; neuron?: NeuronEndpoint } | null;
      if (!current() || !saved) return;
      if (saved.version !== 1 || saved.owner !== owner || !Array.isArray(saved.pairs)) throw new Error('Invalid saved pairing');
      // start revalidates routes and the original immutable public-key pins.
      await startMailboxPrototype(saved.pairs, saved.neuron);
      recoveryError = null;
    } catch { if (configurationRevision === revision && useAppStore.getState().user?.id === owner && !active) recoveryError = 'Saved mailbox pairing could not be restored'; }
    finally { if (restoring === job) restoring = null; }
  })();
  restoring = job;
  return job.promise;
}

/** Runs on local account/foreground hydration, independently of Axion authentication. */
export function initializeMailboxRecovery() {
  if (recoverySubscription || !supported()) return;
  recoverySubscription = useAppStore.subscribe((state, previous) => {
    if (state.user?.id !== previous.user?.id) { stopMailboxPrototype(); recoveryError = null; }
    if (state.user?.id !== previous.user?.id || state.appLifecycle !== previous.appLifecycle
      || state.activeCall !== previous.activeCall || state.net !== previous.net) void restoreMailboxPairing();
  });
  void restoreMailboxPairing();
}

// Bootstrap recovery can run before saved pairing is resumed after process
// death. Existing custody must not become a new server copy during that interval.
configureMailboxTextAttempt(async (message, options) => {
  if (active) return active.attempt(message, options);
  const owner = useAppStore.getState().user?.id;
  if (!owner || !supported() || !message.content || message.replyTo || message.durationMs != null) return null;
  const current = () => useAppStore.getState().user?.id === owner;
  const e = await mailboxStore.get(owner, 'envelope', message.id, Date.now());
  const binding = await getMailboxOutgoing(owner, message.id, Date.now());
  if (!current() || e?.kind !== 'envelope' || e.sender !== owner || !binding?.custody
    || e.roomId !== message.roomId || e.createdAt !== Date.parse(message.createdAt)
    || useAppStore.getState().blockedIds[e.recipient]
    || (options?.targetRecipientId != null && options.targetRecipientId !== e.recipient)
    || (options?.expectedRecipientIds && (options.expectedRecipientIds.length !== 1 || options.expectedRecipientIds[0] !== e.recipient))) return null;
  const row = (await getMessagesByIds([message.id]))[0];
  const room = (await getCachedRooms(owner)).find(r => r.id === message.roomId);
  if (!current() || !row || !row.is_mine || row.is_deleted || row.sender_id !== owner || row.type !== 'text'
    || row.content !== message.content || row.room_id !== message.roomId || Date.parse(row.created_at) !== e.createdAt
    || room?.room_type !== 'direct' || room.members.length !== 2 || !room.members.includes(owner) || !room.members.includes(e.recipient)) return null;
  const digest = await Native!.mailboxDigest!(JSON.stringify([message.id, message.roomId, message.content, Date.parse(message.createdAt)]));
  return current() && digest === binding.digest ? { peerId: e.recipient, delivered: false } : null;
});

/** Developer test entry point. A pinned neuron may introduce existing direct-chat contacts.
 * While paired, eligible normal texts may use custody and signed delivery receipts. */
export async function startMailboxPrototype(pairs: MailboxPair[], neuron?: NeuronEndpoint) {
  stopMailboxPrototype();
  const epoch = generation;
  const self = await mailboxPublicIdentity();
  const owner = self.user;
  if (!Array.isArray(pairs) || pairs.length > 7 || pairs.some(p => !p || p.user === owner || !Number.isSafeInteger(p.user) || p.user < 1
    || typeof p.encryption !== 'string' || p.encryption.length > 512
    || typeof p.signing !== 'string' || p.signing.length > 256
    || (p.roomId !== undefined && (typeof p.roomId !== 'string' || p.roomId.length > 128)))
    || new Set(pairs.map(p => p.user)).size !== pairs.length) throw new Error('Invalid test pairing');
  // Copy caller input so later mutations cannot replace the pinned identity or route.
  const pinned = new Map([self, ...pairs.map(p => ({ ...p }))].map(p => [p.user, p]));
  if (neuron) {
    neuron = { ...neuron };
    const url = new URL(neuron.url);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
      || url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || !neuron.node || pinned.get(neuron.user)?.signing !== neuron.signing || neuron.user === owner) throw new Error('Invalid pinned neuron endpoint');
    neuron.url = neuron.url.replace(/\/$/, '');
  }
  const alive = () => generation === epoch && useAppStore.getState().user?.id === owner;
  const current = () => alive() && useAppStore.getState().appLifecycle === 'active' && !useAppStore.getState().activeCall;
  if (!current()) throw new Error('Mailbox pairing was interrupted');
  await pinMailboxIdentities(owner, [...pinned.values()], current);
  if (!current()) throw new Error('Mailbox pairing was interrupted');
  const crypto: MailboxCrypto = {
    seal: (key, header, plaintext) => Native!.mailboxSeal!(key, header, plaintext),
    open: (user, header, sealed) => Native!.mailboxOpen!(user, header, sealed.wrappedKey, sealed.iv, sealed.ciphertext),
    sign: (user, value) => Native!.mailboxSign!(user, value),
    verify: (key, value, signature) => Native!.mailboxVerify!(key, value, signature),
    digest: value => Native!.mailboxDigest!(value),
  };
  async function peer(roomId: string) {
    const room = (await getCachedRooms(owner)).find(r => r.id === roomId);
    if (!current() || !room || room.room_type !== 'direct' || room.members.length !== 2 || !room.members.includes(owner)) return null;
    const id = room.members.find(id => id !== owner)!;
    const member = room.members_detail.find(p => p.id === id);
    return member && pinned.has(id) && !useAppStore.getState().blockedIds[id] ? { id, name: member.username } : null;
  }
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16);
  });
  const signaling = neuron ? createNeuronSignaling({
    owner, endpoint: neuron, endpointId: uuid(), uuid, now: Date.now,
    current: () => current() && !useAppStore.getState().blockedIds[neuron!.user],
    key: user => !useAppStore.getState().blockedIds[user] ? pinned.get(user)?.signing ?? null : null,
    authorize: async (user, room) => (await peer(room))?.id === user,
    digest: crypto.digest, sign: value => crypto.sign(owner, value), verify: crypto.verify,
    fetch: (...args) => fetch(...args), receive: frame => runtime.handleSignal(frame),
  }) : null;
  const runtime = createP2pTextRuntime({
    application: 'mailbox',
    context: roomId => current() && roomId ? { userId: owner, roomId } : null,
    peer, signalingReady: () => signaling ? signaling.ready() : isNotifWsReady(),
    sendSignal: frame => signaling ? signaling.send(frame) : sendRawNotif(frame),
    connectionWaitMs: signaling ? { host: 3500, internet: 5000, total: 11_000 } : undefined,
    // Session IDs are correlation identifiers only, never cryptographic key material.
    sessionId: uuid,
    preferHostCandidates: true,
    createConnection: hostOnly => createNativeTextPeer(hostOnly ? [] : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']),
    persist: async (_room, peer, message) => {
      const accepted = await node.receive(peer.id, message.content);
      if (accepted) {
        await outbox.reconcile();
        // Only a newly received envelope needs a reply. Receipts must never
        // trigger another receipt flush and an endless signaling exchange.
        try {
          const packet = JSON.parse(message.content);
          if (packet.kind === 'envelope' && packet.recipient === owner) void node.reply(packet.id, peer.id).catch(() => {});
        } catch {}
      }
      return accepted;
    },
    log: (event, id) => { if (alive() && event === 'peer_stored') { directStored++; if (id) { directPackets.push(id); directPackets = directPackets.slice(-8); } } },
  });
  const node = createMailboxNode({
    owner, current, now: Date.now, crypto, store: mailboxStore,
    identity: user => !useAppStore.getState().blockedIds[user] ? pinned.get(user) ?? null : null,
    async persist(envelope, content) {
      const sender = await peer(envelope.roomId);
      if (!current() || sender?.id !== envelope.sender) return false;
      const existing = (await getMessagesByIds([envelope.id]))[0];
      if (!current() || (existing && (existing.room_id !== envelope.roomId || existing.sender_id !== sender.id
        || existing.is_mine || existing.content !== content || existing.type !== 'text'))) return false;
      await ingestMessage({ message_id: envelope.id, room_id: envelope.roomId, sender_id: sender.id,
        sender: sender.name, room_name: sender.name, content, message_type: 'text',
        created_at: new Date(envelope.createdAt).toISOString() }, 'p2p');
      const saved = (await getMessagesByIds([envelope.id]))[0];
      return current() && !useAppStore.getState().blockedIds[sender.id] && saved?.room_id === envelope.roomId
        && saved.sender_id === sender.id && !saved.is_mine && saved.content === content;
    },
    async send(user, packet) {
      if (packet.kind === 'envelope' && packet.sender === owner) {
        const row = (await getMessagesByIds([packet.id]))[0];
        const binding = await getMailboxOutgoing(owner, packet.id, Date.now());
        // Developer-created envelopes without chat rows remain supported. A normal
        // outgoing row must match its durable binding before any relay/retry.
        if ((row || binding) && !await outbox.matches(packet)) return false;
      }
      if (hosted && neuron && user === neuron.user) return current() && !useAppStore.getState().blockedIds[user] && hosted.exchange(packet);
      const roomId = pinned.get(user)?.roomId;
      if (!current() || !roomId || (await peer(roomId))?.id !== user || !current()) return false;
      return await runtime.trySend({ id: `${packet.kind}:${packet.id}`, roomId,
        content: JSON.stringify(packet), createdAt: new Date().toISOString() }, { expectedRecipientIds: [user] }) === user;
    },
  });
  const outbox = createMailboxOutbox({
    owner, current, now: Date.now, node, store: mailboxStore, peer, preferDirect: !!neuron,
    digest: crypto.digest,
    binding: id => getMailboxOutgoing(owner, id, Date.now()),
    bind: (id, digest, expires) => bindMailboxOutgoing(owner, id, digest, expires),
    custody: id => markMailboxCustody(owner, id),
    custodians: () => [...pinned.values()].filter(p => p.user !== owner && (p.roomId || p.user === neuron?.user)
      && !useAppStore.getState().blockedIds[p.user]).map(p => p.user),
    async read(id) {
      const row = (await getMessagesByIds([id]))[0];
      if (!current() || !row || !row.is_mine || row.sender_id !== owner || row.is_deleted || row.type !== 'text') return null;
      return { id: row.id, roomId: row.room_id, content: row.content, createdAt: row.created_at,
        replyTo: row.reply_to, durationMs: row.duration_ms };
    },
    delivered: (message, recipient) => acceptMailboxDelivered(owner, message, recipient, current),
  });
  async function contactRoutes() {
    const rooms = await getCachedRooms(owner);
    const routes = new Map<number, string>();
    if (!current() || !neuron || useAppStore.getState().blockedIds[neuron.user]) return routes;
    for (const room of rooms) {
      if (room.room_type !== 'direct' || room.members.length !== 2 || !room.members.includes(owner)) continue;
      const id = room.members.find(id => id !== owner);
      if (id && id !== neuron.user && !useAppStore.getState().blockedIds[id]) routes.set(id, room.id);
    }
    return routes;
  }
  const hosted = neuron ? createNeuronClient({ owner, endpoint: neuron,
    current: () => current() && !useAppStore.getState().blockedIds[neuron!.user], now: Date.now,
    digest: crypto.digest, sign: value => crypto.sign(owner, value), verify: crypto.verify,
    fetch: (...args) => fetch(...args),
    discover: async () => [...(await contactRoutes()).keys()].sort((a, b) => a - b).slice(0, 8),
    introduce: async entries => {
      // Routes are re-read after the network round trip; no server-supplied room IDs.
      const routes = await contactRoutes();
      for (const entry of entries) {
        const allowed = () => current() && !useAppStore.getState().blockedIds[entry.user]
          && !useAppStore.getState().blockedIds[neuron!.user];
        if (!allowed() || !routes.has(entry.user)) continue;
        const old = pinned.get(entry.user);
        if (old && (old.encryption !== entry.encryption || old.signing !== entry.signing)) continue;
        if (!old && pinned.size >= 8) continue;
        try {
          await pinMailboxIdentities(owner, [entry], allowed);
          if (!allowed()) return;
          pinned.set(entry.user, { ...entry, roomId: routes.get(entry.user)! });
          if (!old && !discoveredPeers.includes(entry.user)) discoveredPeers.push(entry.user);
        } catch { /* A stored key conflict never replaces the original identity. */ }
      }
    },
    receive: async packet => {
      const accepted = await node.receive(neuron!.user, JSON.stringify(packet));
      if (accepted && current()) await outbox.reconcile();
      return accepted;
    },
  }) : null;
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (state.user?.id !== owner) stopMailboxPrototype();
    else if (state.appLifecycle !== previous.appLifecycle || state.activeCall !== previous.activeCall
      || state.blockedIds !== previous.blockedIds) { runtime.reset(); signaling?.reset(); }
  });
  const unsubscribeStatus = subscribeStatus(status => { if (!signaling && status !== 'connected') runtime.signalingLost(); });
  let retrying = false;
  const tick = () => {
    if (!current() || retrying) return;
    retrying = true;
    void (async () => {
      await outbox.reconcile();
      if (hosted) await hosted.exchange();
      for (const pair of pinned.values()) {
        if (!current()) break;
        if (pair.user !== owner && (pair.roomId || pair.user === neuron?.user)) await node.flush(pair.user);
      }
    })().catch(() => {}).finally(() => { retrying = false; });
  };
  const retry = setInterval(tick, 15_000);
  const signalRetry = signaling ? setInterval(() => { void signaling.poll(); }, 250) : null;
  signalingStatus = signaling ? signaling.status : null;
  active = { owner, attempt: outbox.attempt, signal: payload => signaling ? Promise.resolve() : runtime.handleSignal(payload), stop() {
    clearInterval(retry); if (signalRetry) clearInterval(signalRetry);
    hosted?.stop(); signaling?.stop(); runtime.reset(); unsubscribe(); unsubscribeStatus();
  } };
  void signaling?.poll();
  tick();
  return { ...node, pollNeuron: () => hosted?.exchange() ?? Promise.resolve(false), stop: () => { if (alive()) stopMailboxPrototype(); } };
}
