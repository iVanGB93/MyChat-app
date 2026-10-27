import type { CallControl } from './callControlProtocol.ts';
import type { IdentityPeer } from './identityClient.ts';

/** Event-woken direct outbox work; deadlines remain for unacknowledged/unknown work. */
export function createCallRetryScheduler(d: {
  account: string; current(): boolean; now(): number;
  list(): Promise<CallControl[]>; peers(): IdentityPeer[];
  drain(invite: CallControl, peer: IdentityPeer): Promise<number>;
  pending?(invite:CallControl,peer:IdentityPeer):Promise<boolean|undefined>;
}) {
  let stopped=false,busy=false,nextAt=0,cursor=0,hasPending=true,revision=0;
  const idle=new Set<string>();
  const key=(row:CallControl,peer:IdentityPeer)=>[row.callId,peer.account,peer.device,peer.instance].join(':');
  const settled=(row:CallControl,peer:IdentityPeer,pass:number)=>{if(pass===revision){if(idle.size>=640)idle.clear();idle.add(key(row,peer));}};
  return {
    changed(){revision++;idle.clear();hasPending=true;nextAt=0;},
    nextDeadline:()=>stopped||!d.current()||!hasPending?Infinity:nextAt,
    stop(){stopped=true;},
    async tick() {
      if(stopped||busy||!d.current()||d.now()<nextAt)return;
      busy=true;nextAt=d.now()+2000;const pass=revision;
      try {
        const peers=d.peers().filter(p=>p.expiresAt>d.now()).slice(0,10);
        const rows=(await d.list()).slice(0,64).filter(row=>peers.some(p=>p.account===(row.caller===d.account?row.callee:row.caller)&&!idle.has(key(row,p))));hasPending=rows.length>4;
        if(stopped||!d.current()||!rows.length)return;
        for(let n=0;n<Math.min(4,rows.length);n++) {
          const invite=rows[cursor++ % rows.length];
          if(stopped||!d.current())return;
          const remote=invite.caller===d.account?invite.callee:invite.caller;
          for(const peer of peers.filter(p=>p.account===remote&&p.expiresAt>d.now())) {
            if(stopped||!d.current())return;
            if(idle.has(key(invite,peer)))continue;
            if(await d.pending?.(invite,peer)===false){settled(invite,peer,pass);continue;}
            if(stopped||!d.current())return;
            await d.drain(invite,peer);
            if(await d.pending?.(invite,peer)!==false)hasPending=true;else settled(invite,peer,pass);
          }
        }
      } catch(error){hasPending=true;throw error;}
      finally {busy=false;if(pass!==revision){hasPending=true;nextAt=0;}}
    },
  };
}
