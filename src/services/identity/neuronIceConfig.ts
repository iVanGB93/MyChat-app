export const neuronStunConfig=()=>({ice_servers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}],ice_transport_policy:'all' as const});
/** Accept only bounded ICE configuration from an explicitly configured provider's authenticated axon. */
export function parseNeuronIceConfig(raw:string,now:number) {
  try {
    if(typeof raw!=='string'||new TextEncoder().encode(raw).length>6000)return null;
    const input=JSON.parse(raw);
    if(!Number.isSafeInteger(input.expiresAt)||input.expiresAt<=now||input.expiresAt>now+605000
      ||input.ice_transport_policy!=='all'||!Array.isArray(input.ice_servers)||!input.ice_servers.length||input.ice_servers.length>8)return null;
    const ice_servers:{urls:string[];username?:string;credential?:string}[]=[];
    for(const server of input.ice_servers) {
      if(!server||!Array.isArray(server.urls)||!server.urls.length||server.urls.length>8
        ||server.urls.some((u:unknown)=>typeof u!=='string'||u.length>256||!/^(?:stun|turn)s?:[a-zA-Z0-9.-]+(?::[0-9]{1,5})?(?:\?transport=(?:udp|tcp))?$/.test(u)))return null;
      const turn=server.urls.some((u:string)=>u.startsWith('turn'));
      if(turn&&(typeof server.username!=='string'||server.username.length>256||typeof server.credential!=='string'||server.credential.length>256||!server.credential))return null;
      ice_servers.push({urls:server.urls,...(turn?{username:server.username,credential:server.credential}:{})});
    }
    return {ice_servers,ice_transport_policy:'all' as const};
  }catch{return null;}
}
