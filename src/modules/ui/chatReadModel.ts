import {retainEqual} from '../../services/identity/sharedState';
import {rootChatView} from '../../services/identity/rootChatActions';
import type {RootChatState,RootChatMessage} from '../../services/identity/rootChatTypes';

const messageKey=(m:RootChatMessage)=>`${m.direction}:${m.peer}:${m.id}`;
export type ConversationMessages=Record<string,RootChatMessage[]>;
export function indexConversationMessages(state:RootChatState,previous:ConversationMessages):ConversationMessages{
 const next:ConversationMessages={};for(const message of state.messages){const key=message.group?'group:'+message.group.id:message.peer;(next[key]??=[]).push(message);}
 return retainEqual(previous,next);
}
/** Presentation only: protocol queues/actions are not screen state. */
export function createConversationSelector(conversation:string){let previous:RootChatState|undefined;
 return (state:RootChatState,rooms:ConversationMessages)=>{const next:RootChatState={version:1,contacts:state.contacts,groups:state.groups,messages:rooms[conversation]??[]};
  return previous=previous?retainEqual(previous,next):next;
 };
}
/** A bounded single-account read model. Writes continue through the durable ledger. */
export function createChatReadModel(){
 let owner:string|null=null,raw:RootChatState|undefined,view:RootChatState|undefined;
 return {clear(){owner=null;raw=undefined;view=undefined;},
  derive(account:string,next:RootChatState):RootChatState{
   if(owner!==account){raw=undefined;view=undefined;owner=account;}
   const stable=raw?retainEqual(raw,next):next;
   if(stable===raw&&view)return view;
   const unchanged=raw&&view&&stable.messages===raw.messages&&stable.actions===raw.actions&&stable.groupActions===raw.groupActions;
   const derived=unchanged?{...stable,messages:view!.messages}:rootChatView(account,stable);
   if(view&&!unchanged){const old=new Map(view.messages.map(m=>[messageKey(m),m]));derived.messages=derived.messages.map(m=>{const before=old.get(messageKey(m));return before?retainEqual(before,m):m;});}
   raw=stable;view=view?retainEqual(view,derived):derived;return view;
  }};
}
