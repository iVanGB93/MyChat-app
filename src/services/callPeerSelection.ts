import type {SharedRtcCallLease} from './identity/sharedRtcCall';
import type {CallMediaTransport} from './call-media-transport';

export type CallPeerMode='shared'|'dedicated';
export type SelectedCallPeer=SharedRtcCallLease&{mode:CallPeerMode};
const marker='a=x-axonic-call-peer:';
/** Mode travels inside the existing signed, call-bound SDP, never in a UI hint. */
export function callPeerMode(sdp:string):CallPeerMode {
 const lines=sdp.split(/\r?\n/).filter(l=>l.startsWith(marker));
 if(!lines.length)return 'dedicated'; // Standalone callers predating shared peers.
 if(lines.length!==1||!['shared','dedicated'].includes(lines[0].slice(marker.length)))throw Error('Invalid call peer mode');
 return lines[0].slice(marker.length) as CallPeerMode;
}
export function callPeerDescription(data:Record<string,unknown>,mode:CallPeerMode){
 if(typeof data.sdp!=='string')return data;
 return {...data,sdp:data.sdp.split(/\r?\n/).filter(l=>l&&!l.startsWith(marker)).join('\r\n')+'\r\n'+marker+mode+'\r\n'};
}
/** A short shared-peer grace period must not suppress TURN for symmetric NAT.
 * The answerer follows the signed offer's mode. Late borrowed peers are released,
 * never closed; only a connection created for this call is owned by this helper. */
export function createCallPeerSelection(d:{id:string;current():boolean;
 acquire?:()=>Promise<SharedRtcCallLease>;loadIceConfig:CallMediaTransport['loadIceConfig'];
 create(config:Awaited<ReturnType<CallMediaTransport['loadIceConfig']>>):{close():void};
 graceMs?:number;
}){
 let stopped=false,discardShared=false,borrowed:SharedRtcCallLease|null=null,flight:Promise<SharedRtcCallLease|null>|undefined;
 let selected:SelectedCallPeer|undefined,selection:Promise<SelectedCallPeer>|undefined;
 const current=()=>!stopped&&d.current();
 function warm(){
  return flight??=Promise.resolve().then(()=>current()&&!discardShared?(d.acquire?.()??null):null).then(lease=>{
   if(lease&&(!current()||discardShared)){lease.release();return null;}
   borrowed=lease;return lease;
  },()=>null);
 }
 function abandon(){discardShared=true;if(borrowed){borrowed.release();borrowed=null;}}
 async function choose(mode:CallPeerMode|'prefer-shared'){
  if(!current())throw Error('Call ended');
  let lease:SharedRtcCallLease|null=null;
  if(mode==='shared')lease=await warm();
  else if(mode==='prefer-shared'){
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{lease=await Promise.race([warm(),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),d.graceMs??1500);})]);}
   finally{if(timer!==undefined)clearTimeout(timer);}
  }
  if(!current()){abandon();throw Error('Call ended');}
  if(lease?.current()){
   let released=false;const shared=lease;
   selected={...shared,mode:'shared',current:()=>!released&&current()&&shared.current(),release(){if(!released){released=true;borrowed=null;shared.release();}}};
   return selected;
  }
  abandon();if(mode==='shared')throw Error('Offered shared peer unavailable');
  const config=await d.loadIceConfig();if(!current())throw Error('Call ended');
  const connection=d.create(config);let released=false,fingerprint:string|undefined;
  selected={connection,mode:'dedicated',channelLabel:'axonic-call-v1:'+d.id,
   current:()=>!released&&current(),
   validateRemote(sdp){
    if(released||!current()||typeof sdp!=='string'||sdp.length>9000)return false;
    const values=[...new Set(sdp.split(/\r?\n/).filter(l=>l.startsWith('a=fingerprint:')).map(l=>l.toUpperCase()))].sort();
    if(!values.length||values.some(l=>!/^A=FINGERPRINT:SHA-256 (?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(l)))return false;
    const value=values.join('\n');if(fingerprint&&fingerprint!==value)return false;fingerprint=value;return true;
   },release(){if(!released){released=true;connection.close();}}};
  return selected;
 }
 return {warm,
  async select(mode:CallPeerMode|'prefer-shared'){
   if(!current())throw Error('Call ended');
   const result=await (selection??=choose(mode));
   if(!current())throw Error('Call ended');
   if(mode!=='prefer-shared'&&result.mode!==mode)throw Error('Call peer mode changed');
   return result;
  },stop(){stopped=true;if(!selected)abandon();},
 };
}
