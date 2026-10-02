import { validChatBindingChallenge, type ChatBindingChallenge, type ChatBindingProof, type createChatBindingExchange } from './chatIdentityBinding.ts';

/** Metadata only. The send and receive hooks must belong to the authenticated Axion session. */
export function createChatBindingTransport(d: {
  owner: number; now(): number; current(): boolean;
  authorized(roomId: string, peer: number): boolean;
  exchange: ReturnType<typeof createChatBindingExchange>;
  sign(challenge: ChatBindingChallenge): ChatBindingProof;
  send(frame: Record<string, unknown>): boolean;
}) {
  let stopped = false;
  const seen = new Map<string, number>();
  const current = () => !stopped && d.current();
  function send(kind: 'challenge' | 'proof', roomId: string, target: number, payload: ChatBindingChallenge | ChatBindingProof) {
    return current() && d.authorized(roomId, target) && d.send({ type: 'chat_identity_binding', protocol: 1,
      kind, room_id: roomId, target_user_id: target, payload });
  }
  return {
    async request(roomId: string, peer: number): Promise<boolean> {
      if (!current() || !d.authorized(roomId, peer)) return false;
      const c = await d.exchange.challenge(roomId, peer);
      return !!c && send('challenge', roomId, peer, c);
    },
    async receive(frame: Record<string, any>): Promise<boolean> {
      if (!current()) return false;
      try {
        // Snapshot untrusted input before awaits; bound parsing/signature work.
        const raw = JSON.stringify(frame);
        if (raw.length > 12_000 || new TextEncoder().encode(raw).length > 12_000) return false;
        frame = JSON.parse(raw);
        if (frame.event !== 'chat_identity_binding' || frame.protocol !== 1
          || !Number.isSafeInteger(frame.from_user_id) || frame.from_user_id < 1 || frame.from_user_id === d.owner
          || !['challenge', 'proof'].includes(frame.kind)) return false;
        const c: ChatBindingChallenge = frame.kind === 'challenge' ? frame.payload : frame.payload?.challenge;
        if (!validChatBindingChallenge(c, d.now()) || frame.room_id !== c.roomId || !d.authorized(c.roomId, frame.from_user_id)) return false;
        if (frame.kind === 'proof') {
          if (c.requester !== d.owner || c.peer !== frame.from_user_id) return false;
          return current() && await d.exchange.accept(frame.from_user_id, frame.payload) && current();
        }
        if (c.requester !== frame.from_user_id || c.peer !== d.owner) return false;
        for (const [key, expires] of seen) if (expires <= d.now()) seen.delete(key);
        const key = `${frame.from_user_id}:${c.nonce}`;
        if (seen.has(key) || seen.size >= 32) return false;
        seen.set(key, d.now() + 60_000);
        return send('proof', c.roomId, c.requester, d.sign(c));
      } catch { return false; }
    },
    stop() { stopped = true; seen.clear(); d.exchange.stop(); },
  };
}
