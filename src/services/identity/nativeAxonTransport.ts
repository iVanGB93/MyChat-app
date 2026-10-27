import { AXON_FRAME_BYTES, type AxonWire } from './persistentAxon';
import {ATTACHMENT_BULK_FRAME_BYTES,ATTACHMENT_STREAM_FRAME_BYTES} from './attachmentBatch';
import type { NeuronCandidate, ConnectionContext } from './neuronConnections';

export interface NativeAxonTransport {
  axonConnect(host: string, port: number): Promise<string>;
  axonRead(id: string): Promise<string>;
  axonReadPacket?(id:string):Promise<string|Uint8Array>;
  axonWriteBinary?(id:string,bytes:Uint8Array):Promise<boolean>;
  axonWrite(id: string, raw: string): Promise<boolean>;
  axonClose(id: string): void;
  axonEnableBlockStreams?(id:string):void;
  axonEnableAttachments?(id:string):void;
  axonEnableMediaLane?(id:string):void;
  axonEnableBulkAttachments?(id:string):void;
  axonEnableWssBulkAttachments?(id:string):void;
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
    return openNativeWire(native, context, () => native.axonConnect(match[1], Number(match[2])),undefined,true);
  };
}
/** The listener already read one bounded hello to identify the pool slot. Replay it
 * into the normal verifier; a discovered/claimed account is never authentication.
 */
export function adoptNativeAxonWire(native: NativeAxonTransport, id: string, hello: string, context: ConnectionContext) {
  return openNativeWire(native, context, async () => id, hello,true);
}
export async function openNativeWire(native: NativeAxonTransport, context: ConnectionContext,
  dial: () => Promise<string>, firstFrame?: string, lan=false): Promise<AxonWire> {
    let id: string | undefined, closed = false, listening = false, writing = false, queuedBytes = 0;
    let mediaEnabled=false;
    let bulkEnabled=false,blockStreamsEnabled=false;
    const frameLimit=()=>blockStreamsEnabled?ATTACHMENT_STREAM_FRAME_BYTES:bulkEnabled?ATTACHMENT_BULK_FRAME_BYTES:AXON_FRAME_BYTES;
    let receive: ((raw: string) => void) | undefined, notify: (() => void) | undefined;
    let receiveBinary:((raw:Uint8Array)=>void)|undefined;
    const binary=!lan&&typeof native.axonReadPacket==='function'&&typeof native.axonWriteBinary==='function';
    const queue: { raw: string|Uint8Array; bytes: number }[] = [];
    const disposeNative = (key: string) => { try { native.axonClose(key); } catch { /* Best-effort native cleanup. */ } };
    function close() {
      if (closed) return;
      closed = true; context.signal.removeEventListener('abort', close);
      queue.length = 0; queuedBytes = 0;
      if (id) disposeNative(id);
      const callback = notify; receive = undefined; receiveBinary=undefined; notify = undefined;
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
          const raw = binary?await native.axonReadPacket!(id!):await native.axonRead(id!);
          if (closed) return;
          if(raw instanceof Uint8Array){if(!bulkEnabled||!receiveBinary||raw.length<71||raw.length>32838)throw Error('Invalid binary native axon frame');receiveBinary(raw);continue;}
          const limit=frameLimit();
          if (typeof raw !== 'string' || raw.length>limit || new TextEncoder().encode(raw).length > limit) throw Error('Invalid native axon frame');
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
          if (!(typeof frame.raw==='string'?await native.axonWrite(id!,frame.raw):await native.axonWriteBinary!(id!,frame.raw))) throw Error('Axon write failed');
          if (!closed) { queue.shift(); queuedBytes -= frame.bytes; }
        }
      } catch { close(); }
      finally { writing = false; }
    }
    return {
      close,
      wss:!lan,
      mediaLane:typeof native.axonEnableMediaLane==='function',
      // Reuse the negotiated RTC-sized batch on WSS without raising native frame limits.
      smallAttachmentBatches:typeof native.axonEnableMediaLane==='function',
      smallAttachmentWindow:4,
      blockStreams:typeof native.axonEnableBlockStreams==='function',
      bulkAttachments:typeof (lan?native.axonEnableBulkAttachments:native.axonEnableWssBulkAttachments)==='function',
      ...(!lan?{preferredAttachmentBatchChunks:32 as const}:{}),
      enableBulkAttachments(blockStreams){const enable=lan?native.axonEnableBulkAttachments:native.axonEnableWssBulkAttachments;if(!closed&&id&&enable){enable.call(native,id);bulkEnabled=true;if(blockStreams&&native.axonEnableBlockStreams){native.axonEnableBlockStreams(id);blockStreamsEnabled=true;}}},
      enableMediaLane(){if(!closed&&id){native.axonEnableMediaLane?.(id);mediaEnabled=true;}},
      attachments:typeof native.axonEnableAttachments==='function',
      enableAttachments(){if(!closed&&id)native.axonEnableAttachments?.(id);},
      ...(binary?{
        sendBinary(raw:Uint8Array){if(closed||!bulkEnabled||raw.length<71||raw.length>32838||queuedBytes+raw.length>1048576||queue.length>=64){close();throw Error('Binary axon capacity exceeded');}queue.push({raw,bytes:raw.length});queuedBytes+=raw.length;void flush();},
        listenBinary(message:(raw:Uint8Array)=>void){receiveBinary=message;return ()=>{receiveBinary=undefined;};},
      }:{}),
      send(raw) {
        const limit=frameLimit();
        const bytes = raw.length>limit?Infinity:new TextEncoder().encode(raw).length;
        if (closed || !bytes || bytes > limit || queuedBytes + bytes > (bulkEnabled?2*frameLimit()+120000:(mediaEnabled?6:2)*AXON_FRAME_BYTES) || queue.length >= (blockStreamsEnabled?80:mediaEnabled?16:8)) {
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
