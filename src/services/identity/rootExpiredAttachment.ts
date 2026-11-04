import {localAccount} from './localAccount';
import {localRootChat} from './localRootChat';
import {forwardRootMessage} from './rootMessageForward';
import type {RootChatMessage} from './rootChatLedger';

const running=new Map<string,Promise<void>>();
/** Explicit new send only; never mutate an expired signed grant or the original history. */
export function resendExpiredRootAttachment(source:Pick<RootChatMessage,'peer'|'id'|'direction'>):Promise<void>{
 const owner=localAccount.status().account;
 const key=JSON.stringify([owner,source.peer,source.id,source.direction]);
 const pending=running.get(key);if(pending)return pending;
 const work=(async()=>{
  if(!owner||localAccount.status().state!=='unlocked')throw Error('Unlock your account');
  const state=await localRootChat().messageSnapshot(source.peer,source.id,source.direction);
  if(localAccount.status().account!==owner||localAccount.status().state!=='unlocked')throw Error('Account changed');
  const message=state.messages.find(m=>m.peer===source.peer&&m.id===source.id&&m.direction===source.direction);
  if(!message||message.deleted||message.networkCancelledAt!==undefined)throw Error('This message is no longer available to resend');
  if(message.direction!=='outgoing'||!message.attachment||message.status==='delivered'||message.attachment.manifest.expires>Date.now())throw Error('This attachment is not awaiting an expired-transfer retry');
  await forwardRootMessage(source,message.group?'group:'+message.group.id:message.peer);
 })();
 running.set(key,work);void work.finally(()=>{if(running.get(key)===work)running.delete(key);}).catch(()=>{});
 return work;
}
