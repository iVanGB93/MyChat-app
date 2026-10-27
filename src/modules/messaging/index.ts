import Native from '../../../modules/axonic-nearby';
import {localAccount} from '../identity';
import {localRootChat} from '../../services/identity/localRootChat';
import {pendingMessages} from './pendingMessages';
export {pendingMessages} from './pendingMessages';
import {createMessagingCommands} from './commands';

const owner = () => localAccount.status().state === 'unlocked' ? localAccount.status().account : null;
export const messaging = createMessagingCommands({owner, ledger: localRootChat, randomId: () => Native!.identityRandomBytes!(32),pending:pendingMessages.begin,yieldUI:()=>new Promise(resolve=>setTimeout(resolve,16))});
let pendingOwner=owner();
localAccount.subscribe(()=>{const next=owner();if(next!==pendingOwner)pendingMessages.clear();pendingOwner=next;});


/** Read and preference operations only. UI cannot inject protocol IDs or admit incoming traffic. */
export function conversations() {
  const ledger = localRootChat();
  return {snapshot: ledger.snapshot, configure: ledger.configure, configureGroup: ledger.configureGroup, markGroupRead: ledger.markGroupRead};
}



export type {RootChatState,RootChatMessage,RootChatReply,RootChatContact} from '../../services/identity/rootChatTypes';
export {rootChatView,ROOT_REACTIONS,type RootActionKind} from '../../services/identity/rootChatActions';
export {rootGroupMessages,rootGroupMessageIndex,rootGroupPhoto} from '../../services/identity/rootGroups';
export {rootStickerDraft} from '../../services/identity/rootStickerDraft';
export {forwardRootMessage} from '../../services/identity/rootMessageForward';





export {rootMessageStatus,deliveryStatusIcon,deliveryStatusLabel} from '../../services/identity/rootMessageStatus';
export {mobileDeliveryDiagnostics,clearDeliveryCapture} from '../../services/mobileDeliveryDiagnostics';

export {peerTyping,notifyPeerTyping,localAccountNetworkSnapshot} from '../../composition/neuronRuntime';

export {groupMessageInfo} from './groupMessageInfo';
export {messageInfoDescription,messageInfoTimeline,messageInfoRoutes} from './messageInfoState';

export {updateSharedProfileAvatar,removeSharedProfileAvatar} from './profile';



export {subscribeChatActivity,nextChatActivityDeadline} from '../../composition/neuronRuntime';
