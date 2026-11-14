import {deliveryEvidence} from '../../services/identity/deliveryEvidence';
import {pendingRootChat} from '../../services/identity/rootChatLedger';
import type {RootChatState} from '../../services/identity/rootChatTypes';
import type {DeliveryView} from './delivery';

export function createDeliveryOutbox(d:{
  owner():string|null;
  read():Promise<RootChatState>;
  delivered(peer:string,id:string,evidence:ReturnType<typeof deliveryEvidence>):Promise<unknown>;
}){
  let cached:{owner:string;state:RootChatState;view:DeliveryView}|undefined;
  return {
    clear(){cached=undefined;},
    async readOutbox(){
      const owner=d.owner();
      if(!owner)throw Error('Account unavailable');
      const state=await d.read();
      if(d.owner()!==owner)throw Error('Account changed');
      if(cached?.owner===owner&&cached.state===state)return cached.view;
      const rows=pendingRootChat(state,owner);
      const blockedPeers=state.contacts.filter(contact=>contact.blocked).map(contact=>contact.account);
      const outgoingKeys=new Set(state.messages.filter(message=>message.direction==='outgoing').map(message=>message.peer+':'+message.id));
      const view={rows,blockedPeers,outgoingKeys};
      cached={owner,state,view};
      return view;
    },
    acceptDirect(peer:string,id:string,at:number){
      return d.delivered(peer,id,deliveryEvidence('payload',at));
    },
  };
}
