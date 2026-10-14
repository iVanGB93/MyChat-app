/** Local-only observations. No probes, advertised scores, or persistent identifiers. */
export interface PeerQuality {samples:number;responseMs:number;mediaSamples:number;mediaResponseMs:number;mediaBytesPerSecond:number;failures:number;updatedAt:number}
type Peer = {account:string;route:string};
export function createPeerRanking(now:()=>number){
  const records=new Map<string,{quality?:PeerQuality;penalty:number;failedAt:number}>();
  const previous={text:[] as string[],media:[] as string[]};
  function record(id:string){let row=records.get(id);if(!row){if(records.size>=128)records.delete(records.keys().next().value!);row={penalty:0,failedAt:0};records.set(id,row);}return row;}
  function details(peer:Peer,mode:'text'|'media'){
    const row=records.get(peer.account),q=row?.quality;
    const freshness=q?Math.max(0,1-Math.max(0,now()-q.updatedAt)/300000):0;
    const samples=mode==='media'?(q?.mediaSamples??0):(q?.samples??0);
    const confidence=Math.min(1,samples/3)*freshness;
    const response=mode==='media'?q?.mediaResponseMs:q?.responseMs;
    const route=peer.route==='lan'?0:peer.route==='private'?80:160;
    const failures=q? q.failures/Math.max(1,q.samples+q.mediaSamples+q.failures):0;
    // Response time includes remote processing; it is not a raw ping measurement.
    const speed=mode==='media'&&q?.mediaBytesPerSecond?Math.min(2000,65536*1000/q.mediaBytesPerSecond):response??500;
    const penalty=(row?.penalty??0)*Math.max(0,1-Math.max(0,now()-(row?.failedAt??0))/120000);
    const score=route+500*(1-confidence)+Math.min(5000,speed)*confidence+failures*3000*freshness+penalty;
    return {score,quality:confidence>0?'measured' as const:'learning' as const,responseMs:confidence>0?Math.round(response??0):null};
  }
  return {
    observe(id:string,q:PeerQuality){record(id).quality={...q};},
    failed(id:string){const row=record(id);row.penalty=Math.min(4000,row.penalty+1000);row.failedAt=now();},
    rank<T extends Peer>(peers:readonly T[],mode:'text'|'media'='text'){
      const order=previous[mode];
      const rows=peers.map(peer=>({...peer,...details(peer,mode)}));
      // Stable 100 ms score bands avoid switching on tiny timing differences.
      rows.sort((a,b)=>Math.floor(a.score/100)-Math.floor(b.score/100)||
        (order.includes(a.account)?order.indexOf(a.account):999)-(order.includes(b.account)?order.indexOf(b.account):999)||a.account.localeCompare(b.account));
      previous[mode]=rows.map(p=>p.account);
      return rows.map((p,i)=>({...p,rank:i+1}));
    },
    clear(){records.clear();previous.text=[];previous.media=[];}
  };
}
