import type { AxonSignal } from './axonSignaling.ts';
import type { AxonWire } from './persistentAxon.ts';
import type { ConnectionContext, NeuronCandidate } from './neuronConnections.ts';

interface Channel {
  _peerConnectionId?: number; _reactTag?: string;
  label: string; protocol: string; readyState: string; bufferedAmount: number;
  send(data: string): void; close(): void;
  addEventListener(event: string, callback: (event: any) => void): void;
}
export interface AxonPeerConnection {
  localDescription: { type: string; sdp: string } | null;
  iceGatheringState: string; connectionState: string;
  createDataChannel(label: string, options: { ordered: boolean; protocol: string }): Channel;
  createOffer(): Promise<any>; createAnswer(): Promise<any>;
  setLocalDescription(description: any): Promise<void>; setRemoteDescription(description: any): Promise<void>;
  addEventListener(event: string, callback: (event: any) => void): void;
  close(): void;
}
const LABEL = 'axonic-identity-v1';
// UTF-16 length is a cheap lower bound on UTF-8 size. Never allocate an
// encoder buffer for an already-oversized string from an untrusted peer.
const size = (raw: string) => raw.length > 20000 ? Infinity : new TextEncoder().encode(raw).length;
/** Data-only SDP. ICE is gathered into one bounded signed offer/answer, with no TURN configuration. */
export function validAxonSdp(sdp: string) {
  if (typeof sdp !== 'string' || sdp.length > 7000) return false;
  const lines = sdp.split(/\r?\n/), media = lines.filter(l => l.startsWith('m='));
  return size(sdp) <= 7000 && sdp.startsWith('v=0\r\n') && media.length === 1
    && /^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel$/.test(media[0])
    && lines.some(l => /^a=fingerprint:sha-256 (?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(l))
    && !lines.some(l => l.startsWith('a=candidate:') && / typ relay(?: |$)/.test(l));
}
export function createRtcAxonTransport(d: {
  authenticated?(channel: Channel):void;
  account(): string | null; now(): number; random(): Promise<string>;
  createConnection(): AxonPeerConnection;
  /** Native clock for bounded background work where React Native timers can pause. */
  wait?(milliseconds: number): Promise<unknown>;
  sign(target: string, session: string, kind: AxonSignal['kind'], sdp: string): string;
  send(via: string, raw: string): boolean;
  accept(candidate: NeuronCandidate, wire: AxonWire): boolean;
}) {
  type Entry = { account: string; session: string; via: string; stop(): void; answer(s: AxonSignal): Promise<void>; open(): boolean };
  const entries = new Map<string, Entry>();
  let epoch = 0;
  function make(account: string, session: string, via: string, initiator: boolean) {
    if (entries.size >= 5 || entries.has(account) || !d.account()) throw Error('RTC axon capacity');
    const pc = d.createConnection();
    let dead = false, channel: Channel | null = null, answered = false, opened = false;
    let message: ((raw: string) => void) | null = null, closed: (() => void) | null = null;
    let outbound: string[] = [], inbound: string[] = [];
    const deadline = setTimeout(() => { if (!opened) stop(); }, 9000);
    function stop() {
      if (dead) return; dead = true; clearTimeout(deadline);
      if (entries.get(account) === entry) entries.delete(account);
      outbound = []; inbound = [];
      try { channel?.close(); } catch { /* Continue ownership cleanup. */ }
      try { pc.close(); } catch { /* Continue ownership cleanup. */ }
      closed?.();
    }
    function attach(c: Channel) {
      // Android react-native-webrtc reports an empty protocol for incoming channels.
      // The fixed label and independent signed identity handshake still gate this wire.
      if (dead || channel || c.label !== LABEL || (c.protocol !== LABEL && (initiator || c.protocol !== ''))) { c.close(); stop(); return; }
      channel = c;
      const flush = () => {
        if (dead || c.readyState !== 'open') return;
        opened = true; clearTimeout(deadline);
        try { for (const raw of outbound) { if (c.bufferedAmount + size(raw) > 40000) throw Error('RTC queue full'); c.send(raw); } outbound = []; }
        catch { stop(); }
      };
      c.addEventListener('open', flush);
      c.addEventListener('close', stop); c.addEventListener('error', stop);
      c.addEventListener('message', e => {
        if (dead) return;
        if (typeof e.data !== 'string' || !e.data.length || size(e.data) > 20000) { stop(); return; }
        if (message) message(e.data);
        else if (inbound.length < 2 && inbound.reduce((n, s) => n + size(s), 0) + size(e.data) <= 40000) inbound.push(e.data);
        else stop();
      });
      flush();
    }
    pc.addEventListener('datachannel', e => { if (initiator) { e.channel.close(); stop(); } else attach(e.channel); });
    pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) stop();
    });
    const wire: AxonWire = {
      attachments:!!d.authenticated,
      enableAttachments(){if(!dead&&channel)d.authenticated?.(channel);},
      close: stop,
      send(raw) {
        if (dead || size(raw) > 20000) throw Error('RTC axon unavailable');
        if (channel?.readyState === 'open') {
          if (channel.bufferedAmount + size(raw) > 40000) { stop(); throw Error('RTC queue full'); }
          channel.send(raw);
        } else if (outbound.length < 2 && outbound.reduce((n, s) => n + size(s), 0) + size(raw) <= 40000) outbound.push(raw);
        else { stop(); throw Error('RTC queue full'); }
      },
      listen(onMessage, onClosed) {
        message = onMessage; closed = onClosed;
        if (dead) onClosed(); else { const waiting = inbound; inbound = []; waiting.forEach(onMessage); }
        return () => { message = null; closed = null; };
      },
    };
    async function describe(kind: 'offer' | 'answer') {
      await pc.setLocalDescription(kind === 'offer' ? await pc.createOffer() : await pc.createAnswer());
      // Gathering has a deadline; a bounded partial candidate set may still succeed.
      const until = d.now() + 2000;
      for (let attempts = 0; !dead && pc.iceGatheringState !== 'complete' && d.now() < until && attempts < 80; attempts++)
        await (d.wait?.(25) ?? new Promise(resolve => setTimeout(resolve, 25)));
      if (dead) return;
      const sdp = pc.localDescription?.sdp;
      if (!sdp || !validAxonSdp(sdp) || !d.send(via, d.sign(account, session, kind, sdp))) stop();
    }
    const entry: Entry = { account, session, via, stop, open: () => opened,
      async answer(signal) {
        if (dead || !initiator || answered || !validAxonSdp(signal.sdp)) return;
        answered = true;
        try { await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp }); } catch { stop(); }
      },
    };
    entries.set(account, entry);
    return { wire, entry,
      async start(offer?: AxonSignal) {
        try {
          if (initiator) attach(pc.createDataChannel(LABEL, { ordered: true, protocol: LABEL }));
          else { if (!offer || !validAxonSdp(offer.sdp)) { stop(); return; } await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp }); }
          if (!dead) await describe(initiator ? 'offer' : 'answer');
        } catch { stop(); }
      },
    };
  }
  return {
    async connect(candidate: NeuronCandidate, context: ConnectionContext): Promise<AxonWire> {
      const own = d.account(), generation = epoch;
      if (!own || own >= candidate.account || !candidate.endpoint.startsWith('rtc:') || context.signal.aborted) throw Error('Invalid RTC route');
      const session = await d.random();
      if (generation !== epoch || own !== d.account() || context.signal.aborted) throw Error('RTC attempt canceled');
      const item = make(candidate.account, session, candidate.endpoint.slice(4), true);
      const abort = () => item.entry.stop(); context.signal.addEventListener('abort', abort, { once: true });
      const close = item.wire.close; item.wire.close = () => { context.signal.removeEventListener('abort', abort); close(); };
      void item.start(); return item.wire;
    },
    receive(signal: AxonSignal, via: string) {
      if (signal.target !== d.account() || signal.expiresAt <= d.now()) return;
      const old = entries.get(signal.record.account);
      if (signal.kind === 'answer') {
        if (old && old.session === signal.session && old.via === via) void old.answer(signal);
        return;
      }
      if (signal.record.account >= signal.target || old || !validAxonSdp(signal.sdp)) return;
      let item: ReturnType<typeof make>;
      try { item = make(signal.record.account, signal.session, via, false); } catch { return; }
      if (!d.accept({ account: signal.record.account, endpoint: `rtc:${via}`, route: 'internet', expiresAt: signal.expiresAt }, item.wire)) { item.entry.stop(); return; }
      void item.start(signal);
    },
    snapshot: () => [...entries.values()].map(e => ({ account: e.account, open: e.open() })),
    stop() { epoch++; for (const entry of [...entries.values()]) entry.stop(); },
  };
}
