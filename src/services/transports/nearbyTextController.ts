import { createP2pTextRuntime, type P2pTextDependencies } from './p2pTextRuntime';
import type { OutgoingTextMessage, TextDeliveryOptions } from './textTransport';
import type { NearbyEvent } from '../../../modules/axonic-nearby';
interface NativeNearby {
  start(roomId: string, userId: number, peerId: number): Promise<void>;
  stop(): Promise<void>;
  send(frame: string): boolean;
  addListener(name: 'onNearby', listener: (event: NearbyEvent) => void): { remove(): void };
}
export interface NearbyState { enabled: boolean; peers: number; message: string }

/** LAN identities are unverified claims. Restricted to development builds. */
export function createNearbyTextController(deps: P2pTextDependencies, native: NativeNearby | null) {
  let state: NearbyState = { enabled: false, peers: 0, message: 'Nearby is off' };
  let generation = 0;
  let subscription: { remove(): void } | undefined;
  let nativeQueue = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<NearbyState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const runtime = createP2pTextRuntime({ ...deps,
    context: () => state.enabled ? deps.context() : null,
    signalingReady: () => state.enabled && state.peers > 0,
    sendSignal: frame => state.enabled && !!native?.send(JSON.stringify(frame)),
    log: (event, id) => deps.log(`nearby_${event}`, id),
  });
  function stop(message = 'Nearby is off') {
    generation++;
    runtime.reset(); subscription?.remove(); subscription = undefined;
    publish({ enabled: false, peers: 0, message });
    nativeQueue = nativeQueue.catch(() => {}).then(() => native?.stop()).then(() => {}).catch(() => {});
    return nativeQueue;
  }
  return {
    getState: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    stop,
    async start() {
      const stopped = stop();
      const epoch = generation;
      await stopped;
      if (epoch !== generation) throw new Error('Nearby discovery was cancelled.');
      if (!native) throw new Error('A rebuilt Android development app is required for nearby discovery.');
      const context = deps.context();
      if (!context) throw new Error('Open a direct chat while the app is active and no call is running.');
      const peer = await deps.peer(context.roomId, context.userId);
      const current = () => epoch === generation && deps.context()?.userId === context.userId && deps.context()?.roomId === context.roomId;
      if (!current() || !peer) throw new Error('This chat is not available for nearby discovery.');
      subscription = native.addListener('onNearby', event => {
        if (!current()) return;
        if (event.type === 'signal' && event.frame) {
          try { void runtime.handleSignal(JSON.parse(event.frame)).catch(() => {}); } catch { /* Ignore malformed input. */ }
        } else if (event.type === 'peers') {
          const peers = Math.max(0, Math.min(4, event.count ?? 0));
          publish({ peers, message: peers ? 'Nearby device found. Send a message to connect.' : 'Looking for this contact on Wi-Fi…' });
          if (!peers) runtime.signalingLost();
        } else if (event.type === 'error' || event.type === 'stopped') {
          void stop(event.reason || 'Nearby discovery stopped');
        }
      });
      publish({ enabled: true, peers: 0, message: 'Looking for this contact on Wi-Fi…' });
      try {
        nativeQueue = nativeQueue.then(() => { if (current()) return native.start(context.roomId, context.userId, peer.id); });
        await nativeQueue;
        if (!current()) throw new Error('Nearby discovery was cancelled.');
      } catch (error) {
        if (current()) await stop(error instanceof Error ? error.message : 'Nearby discovery failed');
        throw error;
      }
    },
    async trySend(message: OutgoingTextMessage, options?: TextDeliveryOptions) {
      if (!state.enabled) return null;
      return runtime.trySend(message, options);
    },
  };
}
