import type { createNearbyTextController } from './nearbyTextController';

type Scope = { userId: number; roomId: string };
type Controller = ReturnType<typeof createNearbyTextController>;

/** Foreground discovery and recovery, scoped to the current account and chat. */
export function createNearbyRecovery(controller: Controller, deps: {
  context(): Scope | null;
  automatic?: boolean;
  recover(scope: Scope, current: () => boolean): Promise<void>;
}) {
  let intent: Scope | null = null;
  let epoch = 0;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = 2000;
  const listeners = new Set<() => void>();
  let state = { ...controller.getState(), requested: false };
  const matches = () => !!intent && deps.context()?.userId === intent.userId
    && deps.context()?.roomId === intent.roomId;
  const publish = () => {
    state = { ...controller.getState(), requested: !!intent };
    if (intent && !state.enabled) state.message = matches()
      ? 'Waiting to reconnect on Wi-Fi…' : 'Nearby paused until you return to this chat';
    listeners.forEach(fn => fn());
  };
  function cancelTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
  function schedule(ms = delay) {
    if (!matches() || busy || timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; void tick(); }, ms);
  }
  async function tick() {
    if (busy || !matches()) return;
    busy = true;
    const version = epoch;
    const scope = { ...intent! };
    const current = () => version === epoch && matches();
    try {
      if (!controller.getState().enabled) await controller.start();
      if (current() && controller.getState().peers > 0) {
        await deps.recover(scope, () => current() && controller.getState().enabled
          && controller.getState().peers > 0);
      }
      delay = 5000;
    } catch { delay = Math.min(delay * 2, 30000); }
    finally { busy = false; publish(); schedule(); }
  }
  controller.subscribe(() => { publish(); schedule(); });
  return {
    getState: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    trySend: controller.trySend,
    async start() {
      const scope = deps.context();
      if (!scope) throw new Error('Open a direct chat to enable Nearby.');
      epoch++; cancelTimer(); intent = { ...scope }; delay = 2000;
      const version = epoch;
      publish();
      try { await controller.start(); }
      catch (error) {
        if (version === epoch) { intent = null; epoch++; await controller.stop(); publish(); }
        throw error;
      }
      if (version === epoch) schedule();
    },
    async stop() {
      intent = null; epoch++; cancelTimer();
      await controller.stop(); publish();
    },
    /** Automatic mode follows the eligible foreground chat, including account changes. */
    refresh() {
      epoch++; cancelTimer();
      if (deps.automatic) { intent = deps.context(); delay = 2000; }
      const version = epoch;
      void controller.stop().then(() => {
        if (version !== epoch) return;
        publish(); schedule(0);
      });
    },
  };
}
