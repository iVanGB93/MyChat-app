import type { NeuronEndpoint } from './neuronExchange.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL = 20_000;
interface Crypto {
  digest(value: string): Promise<string>;
  sign(value: string): Promise<string>;
  verify(key: string, value: string, signature: string): Promise<boolean>;
}
export interface NeuronSignal {
  version: 1; node: string; id: string; from: number; to: number; time: number;
  endpoint: string; frame: Record<string, any>; signature: string;
}
export interface SignalRequest {
  version: 1; node: string; user: number; time: number; nonce: string;
  signal: NeuronSignal | null; ack: string[]; signature: string;
}
export interface SignalResponse {
  version: 1; node: string; nonce: string; accepted: boolean; signals: NeuronSignal[]; signature: string;
}
export const signalBody = (p: NeuronSignal) => JSON.stringify(['axonic-peer-signal-v1', p.node, p.id, p.from, p.to, p.time, p.endpoint, p.frame]);
export const signalRequestBody = (p: SignalRequest) => JSON.stringify(['axonic-signal-request-v1', p.node, p.user, p.time, p.nonce, p.signal, p.ack]);
export const signalResponseBody = (p: SignalResponse) => JSON.stringify(['axonic-signal-response-v1', p.node, p.nonce, p.accepted, p.signals]);
const userId = (id: unknown): id is number => Number.isSafeInteger(id) && (id as number) > 0;
const signature = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 128;
export function validSignal(p: any, now: number): p is NeuronSignal {
  if (!p || p.version !== 1 || typeof p.node !== 'string' || !UUID.test(p.node)
    || typeof p.id !== 'string' || !UUID.test(p.id) || !userId(p.from) || !userId(p.to) || p.from === p.to
    || !Number.isSafeInteger(p.time) || p.time > now + 5000 || p.time <= now - TTL
    || typeof p.endpoint !== 'string' || !UUID.test(p.endpoint) || !signature(p.signature)) return false;
  const f = p.frame;
  return !!f && f.type === 'p2p_text_signal' && f.protocol === 1 && f.target_user_id === p.to
    && typeof f.room_id === 'string' && UUID.test(f.room_id) && typeof f.session_id === 'string' && UUID.test(f.session_id)
    && (f.target_endpoint_id === null || (typeof f.target_endpoint_id === 'string' && UUID.test(f.target_endpoint_id)))
    && ['offer', 'answer', 'ice', 'close'].includes(f.signal_type) && !!f.data && typeof f.data === 'object'
    && !Array.isArray(f.data) && JSON.stringify(p).length <= 10_000
    && (!['offer', 'answer'].includes(f.signal_type) || (typeof f.data.sdp === 'string'
      && f.data.sdp.length <= 8000 && f.data.sdp.split(/\r?\n/).includes('a=x-axonic-mailbox:1')));
}

/** Portable bounded relay. Signals are ephemeral, signed by their originating device. */
export function createNeuronSignalRelay(d: Crypto & { node: string; key(user: number): string | null; now(): number }) {
  const queue = new Map<string, NeuronSignal>();
  const replays = new Map<string, number>();
  const rates = new Map<number, { start: number; count: number }>();
  function prune(now: number) {
    for (const [id, p] of queue) if (p.time <= now - TTL) queue.delete(id);
    for (const [id, expiry] of replays) if (expiry <= now) replays.delete(id);
  }
  return {
    async exchange(p: SignalRequest): Promise<SignalResponse | null> {
      const now = d.now(); prune(now);
      if (!p || p.version !== 1 || p.node !== d.node || !userId(p.user) || !d.key(p.user)
        || !Number.isSafeInteger(p.time) || Math.abs(p.time - now) > TTL
        || typeof p.nonce !== 'string' || !UUID.test(p.nonce) || !signature(p.signature)
        || !Array.isArray(p.ack) || p.ack.length > 8 || p.ack.some(id => typeof id !== 'string' || !UUID.test(id))
        || !(p.signal === null || (validSignal(p.signal, now) && p.signal.from === p.user
          && p.signal.node === d.node && !!d.key(p.signal.to)))) return null;
      if (!await d.verify(d.key(p.user)!, await d.digest(signalRequestBody(p)), p.signature)) return null;
      let rate = rates.get(p.user);
      if (!rate || now - rate.start >= 60_000) { rate = { start: now, count: 0 }; rates.set(p.user, rate); }
      if (++rate.count > 240) return null;
      const replay = `${p.user}:${p.nonce}`;
      if (replays.has(replay) || replays.size >= 16_384) return null;
      replays.set(replay, now + TTL * 2);
      for (const id of p.ack) if (queue.get(id)?.to === p.user) queue.delete(id);
      let accepted = p.signal === null;
      if (p.signal && await d.verify(d.key(p.user)!, await d.digest(signalBody(p.signal)), p.signal.signature)) {
        const previous = queue.get(p.signal.id);
        const entries = [...queue.values()];
        accepted = previous ? signalBody(previous) === signalBody(p.signal) : queue.size < 256
          && entries.filter(s => s.to === p.signal!.to).length < 32
          && entries.filter(s => s.from === p.user).length < 32;
        if (accepted && !previous) queue.set(p.signal.id, p.signal);
      }
      const result: SignalResponse = { version: 1, node: d.node, nonce: p.nonce, accepted,
        signals: [...queue.values()].filter(s => s.to === p.user).slice(0, 8), signature: '' };
      result.signature = await d.sign(await d.digest(signalResponseBody(result)));
      return result;
    },
  };
}

/** One foreground client. Queue acceptance is not connection or message delivery. */
export function createNeuronSignaling(d: Crypto & {
  owner: number; endpoint: NeuronEndpoint; endpointId: string; uuid(): string; now(): number;
  current(): boolean; key(user: number): string | null;
  authorize(user: number, room: string): Promise<boolean>;
  receive(frame: Record<string, any>): Promise<void>; fetch: typeof fetch;
}) {
  const outgoing: NeuronSignal[] = [];
  const seen = new Map<string, number>();
  const acks = new Set<string>();
  let busy = false, stopped = false, epoch = 0, lastSuccess = 0, nextPoll = 0, failures = 0;
  let controller: AbortController | null = null;
  const current = () => !stopped && d.current();
  const counters = { sent: 0, received: 0 };
  async function poll() {
    if (!current() || busy || d.now() < nextPoll) return false;
    busy = true; const generation = epoch;
    const valid = () => current() && epoch === generation;
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 5000);
    try {
      while (outgoing[0] && outgoing[0].time <= d.now() - TTL) outgoing.shift();
      for (const [id, expiry] of seen) if (expiry <= d.now()) seen.delete(id);
      const signal = outgoing[0] ?? null;
      if (signal && (!d.key(signal.to) || !await d.authorize(signal.to, signal.frame.room_id))) { outgoing.shift(); return false; }
      if (signal && !signal.signature) signal.signature = await d.sign(await d.digest(signalBody(signal)));
      const req: SignalRequest = { version: 1, node: d.endpoint.node, user: d.owner, time: d.now(), nonce: d.uuid(),
        signal, ack: [...acks].slice(0, 8), signature: '' };
      req.signature = await d.sign(await d.digest(signalRequestBody(req)));
      if (!valid()) return false;
      const response = await d.fetch(`${d.endpoint.url}/v1/signals`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal: controller.signal });
      if (!response.ok || !valid()) return false;
      const wire = await response.text(); if (wire.length > 100_000 || !valid()) return false;
      const result: SignalResponse = JSON.parse(wire);
      if (!result || result.version !== 1 || result.node !== req.node || result.nonce !== req.nonce
        || typeof result.accepted !== 'boolean' || !Array.isArray(result.signals) || result.signals.length > 8
        || !signature(result.signature) || !await d.verify(d.endpoint.signing, await d.digest(signalResponseBody(result)), result.signature)
        || !valid()) return false;
      lastSuccess = d.now(); failures = 0;
      for (const id of req.ack) acks.delete(id);
      if (signal && result.accepted && outgoing[0] === signal) { outgoing.shift(); counters.sent++; }
      for (const p of result.signals) {
        if (!valid()) return false;
        if (!validSignal(p, d.now()) || p.node !== d.endpoint.node || p.to !== d.owner) continue;
        // Ack unusable authenticated relay entries too, so they cannot occupy the inbox indefinitely.
        if (acks.size < 32) acks.add(p.id);
        if (seen.has(p.id) || seen.size >= 128 || (p.frame.target_endpoint_id && p.frame.target_endpoint_id !== d.endpointId)) continue;
        const key = d.key(p.from);
        if (!key || !await d.verify(key, await d.digest(signalBody(p)), p.signature)
          || !await d.authorize(p.from, p.frame.room_id) || !valid()) continue;
        seen.set(p.id, p.time + TTL); counters.received++;
        await d.receive({ ...p.frame, event: 'p2p_text_signal', from_user_id: p.from, from_endpoint_id: p.endpoint });
      }
      return valid() && result.accepted;
    } catch { return false; }
    finally {
      clearTimeout(timeout); controller = null; busy = false;
      if (valid()) nextPoll = d.now() + (lastSuccess >= d.now() - 5000
        ? (outgoing.length || acks.size ? 250 : 1000) : Math.min(15_000, 1000 * 2 ** Math.min(++failures, 4)));
    }
  }
  return {
    poll,
    ready: () => current() && lastSuccess > d.now() - 10_000,
    status: () => ({ ...counters, queued: outgoing.length, ready: current() && lastSuccess > d.now() - 10_000 }),
    send(frame: Record<string, unknown>) {
      if (!current() || outgoing.length >= 32 || !userId(frame.target_user_id) || !d.key(frame.target_user_id)) return false;
      const packet: NeuronSignal = { version: 1, node: d.endpoint.node, id: d.uuid(), from: d.owner,
        to: frame.target_user_id, time: d.now(), endpoint: d.endpointId,
        frame: JSON.parse(JSON.stringify(frame)), signature: 'pending' };
      if (!validSignal(packet, d.now())) return false;
      packet.signature = ''; outgoing.push(packet); if (!failures) nextPoll = Math.min(nextPoll, d.now()); return true;
    },
    reset() { epoch++; controller?.abort(); outgoing.length = 0; seen.clear(); acks.clear(); lastSuccess = 0; nextPoll = 0; failures = 0; },
    stop() { stopped = true; epoch++; controller?.abort(); outgoing.length = 0; seen.clear(); acks.clear(); },
  };
}
