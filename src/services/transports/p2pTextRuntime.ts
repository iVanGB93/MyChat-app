import { createP2pTextSession, isHostOnlyTextSdp, isMailboxSdp } from './p2pTextSession';
import type { PrototypeText, TextSignal, TextPeerConnection } from './p2pTextSession';
import type { OutgoingTextMessage, TextDeliveryOptions } from './textTransport';

interface Context { userId: number; roomId: string }
export interface DirectPeer { id: number; name: string }
export interface P2pTextDependencies {
  context(roomId?: string): Context | null;
  signalingReady(): boolean;
  peer(roomId: string, userId: number): Promise<DirectPeer | null>;
  sessionId(): string;
  createConnection(hostOnly?: boolean): TextPeerConnection;
  preferHostCandidates?: boolean;
  application?: 'mailbox';
  connectionWaitMs?: { host: number; internet: number; total: number };
  sendSignal(frame: Record<string, unknown>): boolean;
  persist(roomId: string, peer: DirectPeer, message: PrototypeText): Promise<boolean>;
  log(event: string, messageId?: string): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reuse an established, bounded session even during a signaling outage.
 * The composition supplies signaling; lifecycle and authorization changes reset it. */
export function createP2pTextRuntime(deps: P2pTextDependencies) {
  let generation = 0;
  let resolving = 0;
  const sessions = new Map<string, ReturnType<typeof createP2pTextSession>>();
  const peers = new Map<string, number>();
  const rooms = new Map<string, string>();
  function matches(context: Context, epoch: number) {
    const now = deps.context(context.roomId);
    return epoch === generation && now?.userId === context.userId && now.roomId === context.roomId;
  }
  function reset() {
    generation++;
    for (const session of sessions.values()) session.close();
    sessions.clear();
    peers.clear();
    rooms.clear();
  }
  function create(id: string, context: Context, peer: DirectPeer, epoch: number, hostOnly = false) {
    const session = createP2pTextSession({
      roomId: context.roomId, sessionId: id, peerUserId: peer.id,
      onDiagnostic: (event) => deps.log(`session_${event}`, id),
      hostOnly,
      application: deps.application,
      createConnection: () => deps.createConnection(hostOnly),
      sendSignal: (frame) => matches(context, epoch) && deps.sendSignal(frame),
      persistIncoming: (message) => matches(context, epoch)
        ? deps.persist(context.roomId, peer, message).then((stored) => stored && matches(context, epoch))
        : Promise.resolve(false),
      onClose: () => { if (sessions.get(id) === session) { sessions.delete(id); peers.delete(id); rooms.delete(id); } },
    });
    sessions.set(id, session);
    peers.set(id, peer.id);
    rooms.set(id, context.roomId);
    return session;
  }
  return {
    reset,
    signalingLost() {
      for (const session of sessions.values()) if (!session.isReady()) session.close();
    },
    async handleSignal(raw: Record<string, any>): Promise<void> {
      if (raw.signal_type === 'offer' && isMailboxSdp(raw.data?.sdp) !== (deps.application === 'mailbox')) return;
      if (typeof raw.room_id !== 'string') return;
      const context = deps.context(raw.room_id);
      if (!context || !deps.signalingReady() || raw.event !== 'p2p_text_signal' || raw.protocol !== 1
        || raw.room_id !== context.roomId || !UUID.test(String(raw.session_id))
        || !UUID.test(String(raw.from_endpoint_id)) || !Number.isSafeInteger(raw.from_user_id)
        || !raw.data || typeof raw.data !== 'object'
        || !['offer', 'answer', 'ice', 'close'].includes(raw.signal_type)) return;
      let session = sessions.get(raw.session_id);
      if (!session) {
        if (raw.signal_type !== 'offer' || sessions.size + resolving >= 4) return;
        const epoch = generation;
        resolving++;
        try {
          const peer = await deps.peer(context.roomId, context.userId);
          if (!matches(context, epoch) || !peer || peer.id !== raw.from_user_id || sessions.has(raw.session_id)) return;
          session = create(raw.session_id, context, peer, epoch, isHostOnlyTextSdp(raw.data.sdp));
        } finally { resolving--; }
      }
      await session.handleSignal(raw as TextSignal);
    },
    async trySend(message: OutgoingTextMessage, options?: TextDeliveryOptions): Promise<number | null> {
      const context = deps.context(message.roomId);
      if (!context || message.roomId !== context.roomId || !message.content || message.content.length > 12_000
        || message.replyTo || message.durationMs != null || options?.hydration || options?.targetRecipientId
        || resolving >= 4) return null;
      const epoch = generation;
      const content = message.content;
      let session: ReturnType<typeof createP2pTextSession> | undefined;
      let expired = false;
      let succeeded = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      resolving++;
      const attempt = (async () => {
        const peer = await deps.peer(message.roomId, context.userId);
        if (expired || !peer || !matches(context, epoch)) return null;
        if (options?.expectedRecipientIds && (options.expectedRecipientIds.length !== 1 || options.expectedRecipientIds[0] !== peer.id)) return null;
        // Both the original offerer and answerer may send on an open channel.
        session = [...sessions.entries()].find(([id, candidate]) => peers.get(id) === peer.id
          && rooms.get(id) === message.roomId && candidate.isReady())?.[1];
        if (session) deps.log('session_reused', message.id);
        else {
          if (!deps.signalingReady() || sessions.size >= 4) return null;
          const modes = deps.preferHostCandidates ? [true, false] : [false];
          for (const hostOnly of modes) {
            if (expired || !matches(context, epoch) || !deps.signalingReady() || sessions.size >= 4) return null;
            const candidate = create(deps.sessionId(), context, peer, epoch, hostOnly);
            session = candidate;
            const opened = candidate.waitUntilOpen(hostOnly ? (deps.connectionWaitMs?.host ?? 1500) : (deps.connectionWaitMs?.internet ?? 3000));
            deps.log(hostOnly ? 'attempt_host' : 'attempt_internet', message.id);
            void candidate.offer().catch(() => candidate.close());
            if (await opened && !expired && matches(context, epoch)) break;
            candidate.close(); session = undefined;
          }
          if (!session || expired || !matches(context, epoch)) {
            deps.log('fallback_connection', message.id); return null;
          }
        }
        const stored = await session.send({ id: message.id, content, createdAt: message.createdAt });
        if (!stored || expired || !matches(context, epoch)) {
          deps.log('fallback_no_receipt', message.id); return null;
        }
        deps.log('peer_stored', message.id);
        succeeded = true;
        return peer.id;
      })().catch(() => null);
      try {
        return await Promise.race([attempt, new Promise<null>((resolve) => {
          deadline = setTimeout(() => { expired = true; session?.close(); resolve(null); }, deps.connectionWaitMs?.total ?? (deps.preferHostCandidates ? 7_000 : 5_500));
        })]);
      } finally { expired = true; clearTimeout(deadline); resolving--; if (!succeeded) session?.close(); }
    },
  };
}
