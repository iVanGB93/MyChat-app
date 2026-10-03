import { verifyCallMediaSignal } from './callMediaProtocol.ts';
import type { IdentityPeer } from './identityClient.ts';
import type { IdentityRecordStore } from './identityAdmission.ts';
/** Live forwarding only: no media signaling survives a relay restart or enters its disk store. */
export function createCallMediaRelay(d:{records:Pick<IdentityRecordStore,'read'>;now():number;current():boolean;blocked(account:string):boolean;
  forward(account:string,device:string,raw:string):Promise<boolean>}) {
  let busy=0;
  return async(raw:string,peer:IdentityPeer):Promise<boolean>=>{
    const active=()=>d.current()&&peer.expiresAt>d.now()&&!d.blocked(peer.account);
    if(busy>=2||!active()||typeof raw!=='string'||new TextEncoder().encode(raw).length>12000)return false;
    busy++;
    try {
      const record=await d.records.read(peer.account),event=record&&verifyCallMediaSignal(raw,record,d.now());
      if(!event||event.record.account!==peer.account||event.device!==peer.device||d.blocked(event.target)||!active())return false;
      const result=await d.forward(event.target,event.targetDevice,raw);
      return active()&&event.expiresAt>d.now()&&result;
    }catch{return false;}finally{busy--;}
  };
}
