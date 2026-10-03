import type { CallControl } from './callControlProtocol.ts';
import type { IdentityPeer } from './identityClient.ts';

/** Called by the foreground network tick. Work is bounded, fair, and never overlaps itself. */
export function createCallRetryScheduler(d: {
  account: string; current(): boolean; now(): number;
  list(): Promise<CallControl[]>; peers(): IdentityPeer[];
  drain(invite: CallControl, peer: IdentityPeer): Promise<number>;
}) {
  let stopped=false,busy=false,nextAt=0,cursor=0;
  return {
    stop(){stopped=true;},
    async tick() {
      if(stopped||busy||!d.current()||d.now()<nextAt)return;
      busy=true;nextAt=d.now()+2000;
      try {
        const rows=(await d.list()).slice(0,64);
        if(stopped||!d.current()||!rows.length)return;
        const peers=d.peers().slice(0,10);
        for(let n=0;n<Math.min(4,rows.length);n++) {
          const invite=rows[cursor++ % rows.length];
          if(stopped||!d.current())return;
          const remote=invite.caller===d.account?invite.callee:invite.caller;
          for(const peer of peers.filter(p=>p.account===remote&&p.expiresAt>d.now())) {
            if(stopped||!d.current())return;
            await d.drain(invite,peer);
          }
        }
      } finally {busy=false;}
    },
  };
}
