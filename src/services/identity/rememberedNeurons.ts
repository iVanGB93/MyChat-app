import {validAccountId} from './identityProtocol';
import type {NeuronCandidate} from './neuronConnections';
type Remembered={account:string;endpoint:string;seen:number};
const TTL=24*60*60*1000;
function privateEndpoint(endpoint:string):boolean{
 const match=/^axon-lan:\/\/((?:[0-9]{1,3}\.){3}[0-9]{1,3}):([1-9][0-9]{0,4})$/.exec(endpoint);
 if(!match||Number(match[2])>65535)return false;
 const ip=match[1].split('.').map(Number);if(ip.some(v=>v>255))return false;
 return ip[0]===10||ip[0]===172&&ip[1]>=16&&ip[1]<=31||ip[0]===192&&ip[1]===168||ip[0]===100&&ip[1]>=64&&ip[1]<=127;
}
/** Locators learned only after a signed handshake. Every reconnection authenticates again. */
export function createRememberedNeurons(d:{now():number;read(owner:string):Promise<string|null>;write(owner:string,raw:string):Promise<void>}){
 let tail:Promise<unknown>=Promise.resolve();
 const serialize=<T>(fn:()=>Promise<T>)=>{const pending=tail.then(fn);tail=pending.catch(()=>{});return pending;};
 async function read(owner:string):Promise<Remembered[]>{
  if(!validAccountId(owner))throw Error('Invalid cache owner');
  const raw=await d.read(owner);if(!raw)return [];if(raw.length>12000)return [];
  try{const value=JSON.parse(raw);if(value.version!==1||value.owner!==owner||!Array.isArray(value.peers)||value.peers.length>16)return [];
   return value.peers.filter((p:Remembered)=>p&&validAccountId(p.account)&&p.account!==owner&&typeof p.endpoint==='string'&&privateEndpoint(p.endpoint)&&Number.isSafeInteger(p.seen)&&p.seen<=d.now()+5000&&p.seen>d.now()-TTL);
  }catch{return [];}
 }
 return {
  list:(owner:string)=>serialize(async()=> (await read(owner)).map(p=>({account:p.account,endpoint:p.endpoint,route:'private' as const,expiresAt:p.seen+TTL}))),
  remember:(owner:string,peer:NeuronCandidate)=>serialize(async()=>{
   if(!validAccountId(peer.account)||peer.account===owner||!['lan','private'].includes(peer.route)||!privateEndpoint(peer.endpoint))return;
   const rows=(await read(owner)).filter(p=>p.account!==peer.account);rows.unshift({account:peer.account,endpoint:peer.endpoint,seen:d.now()});
   await d.write(owner,JSON.stringify({version:1,owner,peers:rows.slice(0,16)}));
  }),
 };
}
