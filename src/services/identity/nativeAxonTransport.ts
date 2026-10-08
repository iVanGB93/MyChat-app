import { AXON_FRAME_BYTES, type AxonWire } from './persistentAxon';
import type { NeuronCandidate, ConnectionContext } from './neuronConnections';

export interface NativeAxonTransport {
  axonConnect(host: string, port: number): Promise<string>;
  axonRead(id: string): Promise<string>;
  axonWrite(id: string, raw: string): Promise<boolean>;
  axonClose(id: string): void;
  axonEnableAttachments?(id:string):void;
}
/** Foreground development LAN transport. Native code independently checks the Wi-Fi
 * subnet and bounds frame allocation; callers cannot label an internet route as LAN.
 * Pull reads start only after listen(), preserving early frames during identity setup.
 */
export function createNativeAxonConnector(native: NativeAxonTransport) {
  return async (candidate: NeuronCandidate, context: ConnectionContext): Promise<AxonWire> => {
    const match = /^axon-lan:\/\/((?:[0-9]{1,3}\.){3}[0-9]{1,3}):([1-9][0-9]{0,4})$/.exec(candidate.endpoint);
    const octets = match?.[1].split('.').map(Number);
    if (candidate.route !== 'lan' || !match || !octets || octets.some(n => n > 255)
      || octets.join('.') !== match[1] || Number(match[2]) > 65535
      || !(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
        || (octets[0] === 192 && octets[1] === 168)) || context.signal.aborted) throw Error('Unsupported axon route');
    return openNativeWire(native, context, () => native.axonConnect(match[1], Number(match[2])));
  };
}
/** The listener already read one bounded hello to identify the pool slot. Replay it
 * into the normal verifier; a discovered/claimed account is never authentication.
 */
export function adoptNativeAxonWire(native: NativeAxonTransport, id: string, hello: string, context: ConnectionContext) {
  return openNativeWire(native, context, async () => id, hello);
}
export async function openNativeWire(native: NativeAxonTransport, context: ConnectionContext,
  dial: () => Promise<string>, firstFrame?: string): Promise<AxonWire> {
    let id: string | undefined, closed = false, listening = false, writing = false, queuedBytes = 0;
    let receive: ((raw: string) => void) | undefined, notify: (() => void) | undefined;
    const queue: { raw: string; bytes: number }[] = [];
    const disposeNative = (key: string) => { try { native.axonClose(key); } catch { /* Best-effort native cleanup. */ } };
    function close() {
      if (closed) return;
      closed = true; context.signal.removeEventListener('abort', close);
      queue.length = 0; queuedBytes = 0;
      if (id) disposeNative(id);
      const callback = notify; receive = undefined; notify = undefined;
      try { callback?.(); } catch { /* Observer failures cannot preserve the socket. */ }
    }
    context.signal.addEventListener('abort', close, { once: true });
    try {
      id = await dial();
      if (closed || context.signal.aborted) { disposeNative(id); throw Error('Axon connection canceled'); }
    } catch (error) { close(); throw error; }
    async function read() {
      try {
        if (!closed && firstFrame !== undefined) { const initial = firstFrame; firstFrame = undefined; receive?.(initial); }
        while (!closed && receive) {
          const raw = await native.axonRead(id!);
          if (closed) return;
          if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > AXON_FRAME_BYTES) throw Error('Invalid native axon frame');
          receive?.(raw);
        }
      } catch { close(); }
    }
    async function flush() {
      if (writing) return;
      writing = true;
      try {
        while (!closed && queue.length) {
          const frame = queue[0];
          if (!await native.axonWrite(id!, frame.raw)) throw Error('Axon write failed');
          if (!closed) { queue.shift(); queuedBytes -= frame.bytes; }
        }
      } catch { close(); }
      finally { writing = false; }
    }
    return {
      close,
      attachments:typeof native.axonEnableAttachments==='function',
      enableAttachments(){if(!closed&&id)native.axonEnableAttachments?.(id);},
      send(raw) {
        const bytes = new TextEncoder().encode(raw).length;
        if (closed || !bytes || bytes > AXON_FRAME_BYTES || queuedBytes + bytes > 2 * AXON_FRAME_BYTES || queue.length >= 8) {
          close(); throw Error('Axon send capacity exceeded');
        }
        queue.push({ raw, bytes }); queuedBytes += bytes; void flush();
      },
      listen(message, onClosed) {
        if (listening) throw Error('Axon listener already attached');
        listening = true;
        if (closed) { onClosed(); return () => {}; }
        receive = message; notify = onClosed; void read();
        return () => { receive = undefined; notify = undefined; };
      },
    };
}
