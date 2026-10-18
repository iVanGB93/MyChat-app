import Native from '../../../modules/axonic-nearby';
import {createMobileRecoveryDiscovery} from './mobileRecoveryDiscovery';
import {createMobileIdentityRecordStore} from './identityRecordStore';
import {rootWakeContext,rootWakeBlocked} from './rootCallWake';
import {createWakeSenderRecovery} from './wakeSenderRecovery';
import {acquireMessageWakeLease} from './messageWakeLease';

export const recoverWakeSender=createWakeSenderRecovery({store:createMobileIdentityRecordStore(Date.now),now:Date.now,
 current:async(owner,sender)=>{const current=await rootWakeContext();return current?.account===owner.account&&current.device===owner.device&&!await rootWakeBlocked(owner.account,sender);},
 lookup:async sender=>{
  // Public visitor lookup: does not unlock the user's account or start its chat runtime.
  const discovery=createMobileRecoveryDiscovery();const release=acquireMessageWakeLease();let done=false;
  const deadline=(async()=>{const until=Date.now()+10000;while(!done&&Date.now()<until){
   if(Native?.axonMessageWait)await Native.axonMessageWait(250);else await new Promise<void>(r=>setTimeout(r,250));
  }if(!done)discovery.stop();return {status:'unavailable' as const,queried:0,answered:0,rejected:0,sources:[]};})();
  try{return await Promise.race([discovery.lookup(sender),deadline]);}finally{done=true;discovery.stop();release();}
 }
});
