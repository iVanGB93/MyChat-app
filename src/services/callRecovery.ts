/** One bounded recovery episode. Only the caller initiates ICE restart. */
export function createCallRecovery(d: {
  restart(): Promise<void>; ended(): void; recovering(value: boolean): void;
  outgoing: boolean;
  schedule?(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  cancel?(timer: ReturnType<typeof setTimeout>): void;
}) {
  const schedule = d.schedule ?? ((fn:()=>void,ms:number)=>setTimeout(fn,ms) as ReturnType<typeof setTimeout>), cancel = d.cancel ?? clearTimeout;
  let grace: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
  let active = false, stopped = false, attempted = false, restarting = false;
  function clear() { if (grace !== undefined) cancel(grace); if (deadline !== undefined) cancel(deadline); grace = deadline = undefined; }
  function restart() {
    if (!active || stopped || attempted || restarting || !d.outgoing) return;
    attempted = restarting = true;
    void Promise.resolve().then(()=>{if(active&&!stopped)return d.restart();}).catch(() => { /* Keep the deadline; connectivity may recover independently. */ }).finally(() => { restarting = false; });
  }
  return {
    active: () => active,
    state(state: string) {
      if (stopped) return;
      if (state === 'connected' || state === 'completed') {
        clear(); active = false; attempted = false; d.recovering(false); return;
      }
      if (state !== 'disconnected' && state !== 'failed') return;
      if (!active) {
        active = true; d.recovering(true);
        deadline = schedule(() => { if (stopped || !active) return; clear(); active = false; stopped = true; d.ended(); }, 35000);
        grace = schedule(restart, 5000);
      }
      if (state === 'failed') restart();
    },
    stop() { stopped = true; active = false; clear(); },
  };
}
