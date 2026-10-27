import Native from '../../modules/axonic-nearby';
import {AppState} from 'react-native';
import {hexToBytes} from '@noble/hashes/utils.js';
import {localAccount} from '../services/identity/localAccount';
import {createRootAccountCalls} from '../services/identity/rootAccountCalls';
import {createMobileCallJournalStore,listMobileCallJournals} from '../services/identity/mobileCallJournalStore';
import {ownChatRevision} from '../modules/storage/chatStore';
import {startRootPushRegistration} from '../services/identity/rootPushRegistration';
import {registerRootCallWakeOwner,pendingRootCallWakes,finishRootCallWake,syncRootCallNotification} from '../services/identity/rootCallWake';
import type {IdentityRecordStore} from '../services/identity/identityAdmission';
import type {RootChatState} from '../services/identity/rootChatTypes';
import type {createLanIdentityRuntime} from '../services/identity/lanIdentityRuntime';
import type {NeuronCallView} from '../services/identity/neuronCallCoordinator';
/** Account-scoped Android call notifications and push registration. Shared call
 * protocol/coordinator remain unchanged; this adapter owns their mobile lifetime. */
export function createMobileCallSession(account:string,d:{
 owner():string|null;network():ReturnType<typeof createLanIdentityRuntime>;records:IdentityRecordStore;
 chat():Promise<RootChatState>;inboxChanged(peer:string):void;wake():void;
 activate(runtime:ReturnType<typeof createRootAccountCalls>):void;changed(view:NeuronCallView<string>|null):void;
}){
 let stopped=false;const current=()=>!stopped&&d.owner()===account;
      const callRuntime=createRootAccountCalls({identity:localAccount,network:d.network,records:d.records,
        store:createMobileCallJournalStore(),list:()=>listMobileCallJournals(account),
        listPending:()=>listMobileCallJournals(account,Date.now()),current,
        now:Date.now,random:async()=>hexToBytes(await Native!.identityRandomBytes!(32)),
        contacts:async()=>(await d.chat()).contacts,
        contactsRevision:()=>ownChatRevision(account),eventCallPeer:peer=>d.network().eventCallPeers().includes(peer),inboxChanged:peer=>d.inboxChanged(peer),
        wakes:{pending:()=>pendingRootCallWakes(account),finish:id=>{
          const view=callRuntime.coordinator.snapshot();
          return finishRootCallWake(account,id,AppState.currentState!=='active'&&view?.id===id&&!view.outgoing&&view.status==='ringing');
        }},
        changed:view=>{if(!current())return;Native?.axonCallSetupWindow?.(view&&view.status!=='ready'&&view.status!=='ended'?Math.max(0,Math.min(65000,(view.expiresAt??Date.now())-Date.now())):view?.status==='ended'?5000:0);d.wake();void syncRootCallNotification(account,view).then(shown=>{if(shown&&view&&current())return callRuntime.coordinator.confirmRinging(view.id);}).catch(()=>{});d.changed(view);}});
      d.activate(callRuntime);
      const noticeLifecycle=AppState.addEventListener('change',()=>{if(!current())return;d.wake();const view=callRuntime.coordinator.snapshot();void syncRootCallNotification(account,view).then(shown=>{if(shown&&view&&current())return callRuntime.coordinator.confirmRinging(view.id);}).catch(()=>{});});
      const stopNotice=()=>noticeLifecycle.remove();
      const device=localAccount.callDevice()!;
      const push=startRootPushRegistration(current,(peer,raw)=>d.network().pushRequest(peer,raw));
      
      void registerRootCallWakeOwner(account,device).catch(()=>{});

return {runtime:callRuntime,push,stop(){if(stopped)return;stopped=true;Native?.axonCallSetupWindow?.(0);stopNotice();push.stop();callRuntime.stop();}};
}
