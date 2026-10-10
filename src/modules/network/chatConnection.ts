type Connection={account:string;route:'lan'|'private'|'internet';state:string;expiresAt:number|null};
/** Describes available routes, not proof that any particular message arrived. */
export function chatConnection(peer:string,connections:Connection[],now:number){
 const live=connections.filter(c=>c.state==='connected'&&c.expiresAt!==null&&c.expiresAt>now);
 const ranks={lan:0,private:1,internet:2},direct=live.filter(c=>c.account===peer).sort((a,b)=>ranks[a.route]-ranks[b.route])[0];
 if(direct)return {kind:'direct' as const,label:direct.route==='lan'?'Direct peer · Local Wi-Fi':direct.route==='private'?'Direct peer · Private network':'Direct peer · Internet',color:'#29c97d'};
 if(live.length)return {kind:'network' as const,label:'Via Axonic network · Recipient not directly connected',color:'#e8bd45'};
 return {kind:'offline' as const,label:'No connection · Messages stay queued',color:'#8a96a3'};
}
