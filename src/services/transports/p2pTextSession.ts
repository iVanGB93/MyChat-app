/** Bounded text prototype used only by the development runtime. */
export interface TextSignal {
  protocol: 1;
  room_id: string;
  session_id: string;
  signal_type: 'offer' | 'answer' | 'ice' | 'close';
  data: Record<string, any>;
  from_user_id: number;
  from_endpoint_id: string;
}

export interface PrototypeText {
  id: string;
  content: string;
  createdAt: string;
}

interface Channel {
  label: string;
  protocol: string;
  readyState: string;
  bufferedAmount: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: any) => void): void;
}

export interface TextPeerConnection {
  localDescription: { type: string; sdp: string } | null;
  connectionState: string;
  createDataChannel(label: string, options: { ordered: boolean; protocol: string }): Channel;
  createOffer(): Promise<any>;
  createAnswer(): Promise<any>;
  setLocalDescription(description: any): Promise<void>;
  setRemoteDescription(description: any): Promise<void>;
  addIceCandidate(candidate: any): Promise<void>;
  addEventListener(type: string, listener: (event: any) => void): void;
  close(): void;
}

interface SessionOptions {
  roomId: string;
  sessionId: string;
  peerUserId: number;
  createConnection(): TextPeerConnection;
  sendSignal(frame: Record<string, unknown>): boolean;
  /** Resolve true only after local persistence; false/rejection sends no receipt. */
  persistIncoming(message: PrototypeText): Promise<boolean>;
  onClose?(): void;
  onDiagnostic?(event: string): void;
  /** Both updated peers omit STUN/TURN during this bounded attempt. */
  hostOnly?: boolean;
  application?: 'mailbox';
}

const MAILBOX_ATTRIBUTE = 'a=x-axonic-mailbox:1';
export function isMailboxSdp(sdp: unknown): boolean {
  return typeof sdp === 'string' && sdp.split(/\r?\n/).includes(MAILBOX_ATTRIBUTE);
}
const HOST_ONLY_ATTRIBUTE = 'a=x-axonic-host-only:1';
export function isHostOnlyTextSdp(sdp: unknown): boolean {
  return typeof sdp === 'string' && sdp.split(/\r?\n/).includes(HOST_ONLY_ATTRIBUTE);
}
function nativeSdp(sdp: string): string {
  if (!isHostOnlyTextSdp(sdp) && !isMailboxSdp(sdp)) return sdp;
  return sdp.split(/\r?\n/).filter(line => line !== HOST_ONLY_ATTRIBUTE && line !== MAILBOX_ATTRIBUTE).join('\r\n');
}

const LABEL = 'axonic-text-v1';
const MAX_PACKET_CHARS = 16_384;

/**
 * One bounded connection for one authenticated room peer. Caller owns discovery,
 * account/background teardown and authorization. No media tracks, no call state,
 * no database or UI writes here. Application encryption is a later layer.
 */
export function createP2pTextSession(options: SessionOptions) {
  const label = options.application === 'mailbox' ? 'axonic-mailbox-v1' : LABEL;
  const pc = options.createConnection();
  let channel: Channel | null = null;
  let endpoint: string | null = null;
  let role: 'offerer' | 'answerer' | null = null;
  let remoteReady = false;
  let peerListening = false;
  let announcedReady = false;
  let closed = false;
  let localCandidates: Record<string, unknown>[] = [];
  let remoteCandidates: Array<{ endpoint: string; data: Record<string, unknown> }> = [];
  let incomingCount = 0;
  let receiveTail = Promise.resolve();
  let signalTail = Promise.resolve();
  const pending = new Map<string, { resolve(value: boolean): void; timer: ReturnType<typeof setTimeout> }>();
  const openWaiters = new Set<(open: boolean) => void>();
  const connectionTimer = setTimeout(close, 10_000);
  // Bound authorization staleness while signaling is unavailable. A new
  // server-authorized handshake is required after this experimental lease.
  const lifetimeTimer = setTimeout(close, 300_000);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(close, 60_000);
  }

  function signal(kind: TextSignal['signal_type'], data: Record<string, unknown>): boolean {
    if (closed) return false;
    try {
      // An SDP extension survives the existing signaling envelope. Strip it
      // before handing remote descriptions to native WebRTC.
      if (options.hostOnly && (kind === 'offer' || kind === 'answer') && typeof data.sdp === 'string') {
        data = { ...data, sdp: data.sdp.trimEnd() + '\r\n' + HOST_ONLY_ATTRIBUTE + '\r\n' };
      }
      if (options.application === 'mailbox' && (kind === 'offer' || kind === 'answer') && typeof data.sdp === 'string') {
        data = { ...data, sdp: data.sdp.trimEnd() + '\r\n' + MAILBOX_ATTRIBUTE + '\r\n' };
      }
      return options.sendSignal({ type: 'p2p_text_signal', protocol: 1,
        room_id: options.roomId, session_id: options.sessionId,
        target_user_id: options.peerUserId, target_endpoint_id: endpoint,
        signal_type: kind, data });
    } catch { return false; }
  }

  function close() {
    if (closed) return;
    if (endpoint) signal('close', {});
    closed = true;
    clearTimeout(connectionTimer);
    clearTimeout(lifetimeTimer);
    clearTimeout(idleTimer);
    for (const resolve of openWaiters) resolve(false);
    openWaiters.clear();
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.resolve(false); }
    pending.clear();
    localCandidates = []; remoteCandidates = [];
    try { channel?.close(); } catch {}
    try { pc.close(); } catch {}
    options.onClose?.();
  }

  function transmit(packet: Record<string, unknown>): boolean {
    if (closed || channel?.readyState !== 'open' || channel.bufferedAmount > 65_536) return false;
    const wire = JSON.stringify({ ...packet, protocol: 1, session_id: options.sessionId, room_id: options.roomId });
    if (wire.length > MAX_PACKET_CHARS) return false;
    try { channel.send(wire); touch(); options.onDiagnostic?.(`sent_${packet.type}`); return true; } catch { return false; }
  }

  function readyForText() {
    return !closed && channel?.readyState === 'open' && (role === 'answerer' || peerListening);
  }

  function channelOpened() {
    if (closed || channel?.readyState !== 'open') return;
    // Native channel-open can precede installation of the remote JS listener.
    // The answerer announces readiness only after attaching its message handler.
    if (role === 'answerer' && !announcedReady) {
      announcedReady = transmit({ type: 'ready' });
      if (!announcedReady) { close(); return; }
    }
    if (!readyForText()) return;
    touch();
    clearTimeout(connectionTimer);
    for (const resolve of openWaiters) resolve(true);
    openWaiters.clear();
  }

  async function receive(raw: unknown) {
    if (closed || typeof raw !== 'string' || raw.length > MAX_PACKET_CHARS) return;
    let packet: any;
    try { packet = JSON.parse(raw); } catch { return; }
    if (!packet || packet.protocol !== 1 || packet.session_id !== options.sessionId || packet.room_id !== options.roomId) return;
    if (packet.type === 'ready') {
      if (role === 'offerer') {
        peerListening = true;
        options.onDiagnostic?.('received_ready');
        channelOpened();
      }
      return;
    }
    if (typeof packet.id !== 'string' || !packet.id || packet.id.length > 128) return;
    options.onDiagnostic?.(`received_${packet.type === 'text' ? 'text' : packet.type === 'stored' ? 'stored' : 'unknown'}`);
    if (packet.type === 'stored') {
      const entry = pending.get(packet.id);
      if (entry) { touch(); clearTimeout(entry.timer); pending.delete(packet.id); entry.resolve(true); }
    } else if (packet.type === 'text' && typeof packet.content === 'string'
      && typeof packet.createdAt === 'string' && Number.isFinite(Date.parse(packet.createdAt))) {
      touch();
      const saved = await options.persistIncoming({ id: packet.id, content: packet.content, createdAt: packet.createdAt });
      options.onDiagnostic?.(saved ? 'persisted' : 'persist_rejected');
      if (saved && !closed) transmit({ type: 'stored', id: packet.id });
    }
  }

  function attach(next: Channel) {
    // Android react-native-webrtc reports an empty protocol for remote channels.
    // Keep rejecting explicit mismatches; every packet also validates protocol,
    // session and room before processing over the authenticated peer session.
    if (closed || channel || next.label !== label || (next.protocol !== '' && next.protocol !== label)) { next.close(); return; }
    channel = next;
    options.onDiagnostic?.('channel_attached');
    next.addEventListener('open', () => {
      options.onDiagnostic?.('channel_open');
      channelOpened();
    });
    next.addEventListener('close', close);
    next.addEventListener('error', close);
    next.addEventListener('message', (event) => {
      if (closed) return;
      if (++incomingCount > 32) { close(); return; }
      receiveTail = receiveTail.then(() => receive(event.data)).catch(() => {}).finally(() => { incomingCount--; });
    });
    channelOpened();
  }

  pc.addEventListener('datachannel', (event) => attach(event.channel));
  pc.addEventListener('connectionstatechange', () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) close();
  });
  pc.addEventListener('icecandidate', (event) => {
    if (closed || !event.candidate) return;
    const candidate = event.candidate.toJSON();
    if (endpoint) { if (!signal('ice', candidate) && !readyForText()) close(); }
    else if (localCandidates.length < 64) localCandidates.push(candidate);
    else close();
  });

  async function applySignal(frame: TextSignal) {
    if (closed || frame.protocol !== 1 || frame.room_id !== options.roomId
      || frame.session_id !== options.sessionId || frame.from_user_id !== options.peerUserId
      || !frame.from_endpoint_id || (endpoint && endpoint !== frame.from_endpoint_id)) return;
    if (frame.signal_type === 'offer' && !role) {
      if (isMailboxSdp(frame.data.sdp) !== (options.application === 'mailbox')) { close(); return; }
      role = 'answerer'; endpoint = frame.from_endpoint_id;
      await pc.setRemoteDescription({ type: 'offer', sdp: nativeSdp(frame.data.sdp) });
      if (closed) return;
      remoteReady = true;
      const answer = await pc.createAnswer();
      if (closed) return;
      await pc.setLocalDescription(answer);
      if (closed) return;
      if (!signal('answer', { type: 'answer', sdp: pc.localDescription?.sdp })) close();
    } else if (frame.signal_type === 'answer' && role === 'offerer' && !remoteReady) {
      if (isMailboxSdp(frame.data.sdp) !== (options.application === 'mailbox')) { close(); return; }
      endpoint = frame.from_endpoint_id;
      // Older peers may ignore the preference. Fall back through a fresh
      // ordinary session instead of labelling their path host-only.
      if (options.hostOnly && !isHostOnlyTextSdp(frame.data.sdp)) { close(); return; }
      await pc.setRemoteDescription({ type: 'answer', sdp: nativeSdp(frame.data.sdp) });
      if (closed) return;
      remoteReady = true;
    } else if (frame.signal_type === 'ice' && role) {
      if (remoteReady) await pc.addIceCandidate(frame.data);
      else if (remoteCandidates.length < 64) remoteCandidates.push({ endpoint: frame.from_endpoint_id, data: frame.data });
      else close();
    } else if (frame.signal_type === 'close' && endpoint) close();
    if (closed) return;
    if (remoteReady) {
      for (const candidate of remoteCandidates.splice(0)) {
        if (closed) return;
        if (candidate.endpoint === endpoint) await pc.addIceCandidate(candidate.data);
      }
      for (const candidate of localCandidates.splice(0)) if (!signal('ice', candidate)) { close(); return; }
    }
  }

  return {
    isReady: readyForText,
    waitUntilOpen(timeoutMs = 3_000): Promise<boolean> {
      if (closed) return Promise.resolve(false);
      if (readyForText()) return Promise.resolve(true);
      return new Promise((resolve) => {
        const finish = (open: boolean) => {
          clearTimeout(timer); openWaiters.delete(finish); resolve(open);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        openWaiters.add(finish);
      });
    },
    async offer() {
      if (closed || role) return false;
      role = 'offerer';
      try {
        attach(pc.createDataChannel(label, { ordered: true, protocol: label }));
        const offer = await pc.createOffer();
        if (closed) return false;
        await pc.setLocalDescription(offer);
        if (closed) return false;
        if (!signal('offer', { type: 'offer', sdp: pc.localDescription?.sdp })) { close(); return false; }
        return true;
      } catch { close(); return false; }
    },
    handleSignal(frame: TextSignal) {
      signalTail = signalTail.then(() => applySignal(frame)).catch(() => { close(); });
      return signalTail;
    },
    /** True requires a matching peer storage receipt, not just DataChannel.send. */
    send(message: PrototypeText): Promise<boolean> {
      if (!readyForText() || !message.id || message.id.length > 128 || pending.has(message.id) || pending.size >= 16) return Promise.resolve(false);
      return new Promise((resolve) => {
        const timer = setTimeout(() => { pending.delete(message.id); resolve(false); }, 2_000);
        pending.set(message.id, { resolve, timer });
        if (!transmit({ ...message, type: 'text' })) {
          clearTimeout(timer); pending.delete(message.id); resolve(false);
        }
      });
    },
    close,
  };
}
