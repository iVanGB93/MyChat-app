import {createIncomingMessageAdmission} from '../../services/identity/incomingMessageAdmission';
import {deliveryEvidence} from '../../services/identity/deliveryEvidence';
import {localRootChat} from '../../services/identity/localRootChat';
import {rootChatView} from '../../services/identity/rootChatActions';
import {shortIdentity} from '../../services/identity/identityPresentation';
import {rootNotificationPreviewText} from '../../services/identity/rootNotificationPreviewText';
import {finishRootMessageWake} from '../../services/identity/rootMessageWake';

/** Phone inbox adapter. Acknowledgement follows the ledger commit. Presentation
 * has its own lifetime so an Android wake can await it without delaying delivery. */
export function createMobileIncomingMessages(owner: () => string | null) {
  const incomingPresentation=new Map<string,Promise<void>>();
  const presentationKey=(account:string,sender:string,id:string)=>account+":"+sender+":"+id;
  const receiveMessage=createIncomingMessageAdmission({owner,receive:async(message,relay)=>{
    const account=owner();if(!account)return false;
    const began=performance.now(),ledger=localRootChat();
    return ledger.receive(message.from,message.id,message.text,deliveryEvidence('payload',Date.now(),relay),committedState=>{
      const committed=performance.now();
      const key=presentationKey(account,message.from,message.id);
      // The scoped admission read already includes any actions for this message.
      // Reuse that committed view instead of joining the ledger queue a second time.
      const work=Promise.resolve().then(async()=>{
        if(owner()!==account)return;
        const matching=committedState.messages.find(m=>m.direction==='incoming'&&m.peer===message.from&&m.id===message.id);
        const state=rootChatView(account,{...committedState,messages:matching?[matching]:[]}),m=state.messages[0];
        const contact=state.contacts.find(c=>c.account===message.from),group=m?.group&&state.groups?.find(g=>g.id===m.group!.id);
        const preview=m?{name:group?.name||contact?.alias||shortIdentity(message.from),senderName:contact?.alias||shortIdentity(message.from),text:rootNotificationPreviewText(m),at:m.at,read:!!m.read||!!m.deleted,...(m.group?{group:m.group.id,orderId:m.group.messageId}:{})}:undefined;
        if(owner()===account)await finishRootMessageWake(account,message.from,message.id,preview);
      }).catch(()=>{}).finally(()=>{
        if(incomingPresentation.get(key)===work)incomingPresentation.delete(key);
        console.info('[Axonic incoming presentation]',{presentationMs:Math.round(performance.now()-committed)});
      });
      incomingPresentation.set(key,work);
      console.info('[Axonic incoming timing]',{admissionMs:Math.round(committed-began)});
    });
  }});
  return {
    receiveMessage,
    waitForMessagePresentation: (account: string, sender: string, id: string) =>
      incomingPresentation.get(presentationKey(account, sender, id)),
  };
}
