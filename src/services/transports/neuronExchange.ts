import type { MailboxPacket } from './mailboxProtocol.js';

/** Portable, explicitly pinned development transport. No account tokens travel to peers. */
export interface NeuronRequest {
  version: 1; node: string; user: number; time: number; nonce: string;
  packet: MailboxPacket | null; signature: string; discover?: number[];
}
export interface NeuronIntroduction { user: number; encryption: string; signing: string }
export interface NeuronResponse {
  version: 1; node: string; nonce: string; accepted: boolean;
  packets: MailboxPacket[]; online: number[]; signature: string; directory?: NeuronIntroduction[];
}
export const validDiscovery = (ids: unknown): ids is number[] => Array.isArray(ids) && ids.length <= 8
  && ids.every(id => Number.isSafeInteger(id) && id > 0) && new Set(ids).size === ids.length;
export const validDirectory = (entries: unknown): entries is NeuronIntroduction[] => Array.isArray(entries) && entries.length <= 8
  && entries.every(p => p && Number.isSafeInteger(p.user) && p.user > 0
    && typeof p.encryption === 'string' && p.encryption.length > 0 && p.encryption.length <= 512
    && typeof p.signing === 'string' && p.signing.length > 0 && p.signing.length <= 256)
  && new Set(entries.map(p => p.user)).size === entries.length;
export const requestBody = (p: NeuronRequest) => JSON.stringify(p.discover !== undefined ? [
  'axonic-neuron-request-directory-v1', p.node, p.user, p.time, p.nonce, p.packet, p.discover,
] : [
  'axonic-neuron-request-v1', p.node, p.user, p.time, p.nonce, p.packet,
]);
export const responseBody = (p: NeuronResponse) => JSON.stringify(p.directory !== undefined ? [
  'axonic-neuron-response-directory-v1', p.node, p.nonce, p.accepted, p.packets, p.online, p.directory,
] : [
  'axonic-neuron-response-v1', p.node, p.nonce, p.accepted, p.packets, p.online,
]);
export interface NeuronEndpoint { url: string; node: string; user: number; signing: string }
export function createNeuronClient(d: {
  owner: number; endpoint: NeuronEndpoint; current(): boolean;
  digest(value: string): Promise<string>; sign(value: string): Promise<string>;
  verify(key: string, value: string, signature: string): Promise<boolean>;
  receive(packet: MailboxPacket): Promise<boolean>;
  discover?(): Promise<number[]>;
  introduce?(entries: NeuronIntroduction[]): Promise<void>;
  fetch: typeof fetch; now(): number;
}) {
  let counter = 0;
  let stopped = false;
  let busy = false;
  let controller: AbortController | null = null;
  // Correlation only; request authentication comes from the device signing key.
  const session = `${d.now()}-${Math.random().toString(36).slice(2)}`;
  const current = () => !stopped && d.current();
  return {
    stop() { stopped = true; controller?.abort(); },
    async exchange(packet: MailboxPacket | null = null): Promise<boolean> {
      if (!current() || busy) return false;
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        const req: NeuronRequest = { version: 1, node: d.endpoint.node, user: d.owner,
          time: d.now(), nonce: `${session}-${++counter}`, packet, signature: '' };
        if (d.discover) {
          req.discover = await d.discover();
          if (!validDiscovery(req.discover) || !current()) return false;
        }
        req.signature = await d.sign(await d.digest(requestBody(req)));
        if (!current()) return false;
        const response = await d.fetch(`${d.endpoint.url}/v1/exchange`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req), signal: controller.signal,
        });
        if (!response.ok || !current()) return false;
        const text = await response.text();
        if (text.length > 100_000 || !current()) return false;
        const result: NeuronResponse = JSON.parse(text);
        if (result.version !== 1 || result.node !== req.node || result.nonce !== req.nonce
          || typeof result.accepted !== 'boolean' || !Array.isArray(result.packets) || result.packets.length > 8
          || !Array.isArray(result.online) || result.online.length > 32
          || (result.directory !== undefined && (!validDirectory(result.directory)
            || !req.discover || result.directory.some(p => !req.discover!.includes(p.user))))
          || typeof result.signature !== 'string' || result.signature.length > 128
          || !await d.verify(d.endpoint.signing, await d.digest(responseBody(result)), result.signature) || !current()) return false;
        if (result.directory) await d.introduce?.(result.directory);
        for (const p of result.packets) { if (!current()) return false; await d.receive(p); }
        return current() && result.accepted;
      } catch { return false; }
      finally { clearTimeout(timeout); controller = null; busy = false; }
    },
  };
}
