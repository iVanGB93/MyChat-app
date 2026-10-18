import {createPeerRanking,type PeerQuality} from './peerRanking.ts';

type SessionSnapshot={account:string|null;state:string;quality:PeerQuality;closeReason?:string|null};
type Connection={account:string;route:string;state:string};
/** Shared routing view over authenticated sessions. Owns no sockets or timers.
 * Transport adapters retain admission, cancellation and lifecycle ownership. */
export function createSessionRouting<S extends {snapshot():SessionSnapshot},C extends Connection>(d:{
 now():number;sessions():Iterable<S>;connections():readonly C[];
}){
 const ranking=createPeerRanking(d.now);
 function rankedConnections(mode:'text'|'media'='text'){
  for(const session of d.sessions()){const snap=session.snapshot();if(snap.account)ranking.observe(snap.account,snap.quality);}
  return ranking.rank(d.connections().filter(c=>c.state==='connected'),mode);
 }
 function rankedSessions(mode:'text'|'media'='text'){
  const order=new Map(rankedConnections(mode).map((c,i)=>[c.account,i]));
  return [...d.sessions()].map(session=>({session,account:session.snapshot().account}))
   .filter(row=>row.account!==null&&order.has(row.account))
   .sort((a,b)=>order.get(a.account!)!-order.get(b.account!)!).map(row=>row.session);
 }
 return {
  rankedConnections,rankedSessions,
  connectedSession(account:string){return [...d.sessions()].find(session=>{const s=session.snapshot();return s.account===account&&s.state==='connected';});},
  closed(s:SessionSnapshot){if(s.account){ranking.observe(s.account,s.quality);if(s.closeReason!=='session-stopped'&&s.closeReason!=='inactive-session')ranking.failed(s.account);}},
  clear(){ranking.clear();},
 };
}

