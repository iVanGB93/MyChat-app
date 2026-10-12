import {validAccountId} from './identityProtocol.ts';

/** Routing only: the receiver must still verify the signed signal and accepted
 * call state. The forward endpoint understands call-bound (not axon-bound) IDs. */
export async function routeCallMedia(raw:string,d:{current():boolean;
 direct(account:string,device:string,raw:string):Promise<boolean>;
 relay(raw:string):Promise<boolean>}) {
 if(!d.current()||typeof raw!=='string'||new TextEncoder().encode(raw).length>12000)return false;
 let target:string,device:string;
 try{const event=JSON.parse(raw);target=event.target;device=event.targetDevice;
  if(!validAccountId(target)||typeof device!=='string'||!/^[a-f0-9]{64}$/.test(device))return false;
 }catch{return false;}
 try{if(await d.direct(target,device,raw))return d.current();}catch{/* A lost direct axon may still have a relay route. */}
 if(!d.current())return false;
 try{return await d.relay(raw)&&d.current();}catch{return false;}
}
