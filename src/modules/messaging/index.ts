import Native from '../../../modules/axonic-nearby';
import {localAccount} from '../identity';
import {localRootChat} from '../../services/identity/localRootChat';
import {localAccountCalls as activeCallSession,localAccountNetworkSnapshot,ensureLocalPeerIdentity} from '../../composition/neuronRuntime';
import {createMessagingCommands} from './commands';
import {createCallCommands} from './callCommands';

const owner = () => localAccount.status().state === 'unlocked' ? localAccount.status().account : null;
export const messaging = createMessagingCommands({owner, ledger: localRootChat, randomId: () => Native!.identityRandomBytes!(32)});
export const calling = createCallCommands({owner, calls: activeCallSession,
  connected: () => !!localAccountNetworkSnapshot()?.pool?.connections.some(c => c.state === 'connected'), resolve: ensureLocalPeerIdentity});

/** Read and preference operations only. UI cannot inject protocol IDs or admit incoming traffic. */
export function conversations() {
  const ledger = localRootChat();
  return {snapshot: ledger.snapshot, configure: ledger.configure, configureGroup: ledger.configureGroup, markGroupRead: ledger.markGroupRead};
}
/** Active-call controls only; initiation must go through calling.start. */
export function localAccountCalls(): Pick<NonNullable<ReturnType<typeof activeCallSession>>, 'snapshot' | 'accept' | 'end'> | null {
  return activeCallSession();
}
export {subscribeLocalAccountCalls} from '../../composition/neuronRuntime';
export type {NeuronCallView} from '../../services/identity/neuronCallCoordinator';
export type {RootChatState,RootChatMessage,RootChatReply,RootChatContact} from '../../services/identity/rootChatTypes';
export {rootChatView,ROOT_REACTIONS,type RootActionKind} from '../../services/identity/rootChatActions';
export {rootGroupMessages} from '../../services/identity/rootGroups';
export {rootStickerDraft} from '../../services/identity/rootStickerDraft';
export {forwardRootMessage} from '../../services/identity/rootMessageForward';
export {queueRootAttachmentSource,queueRootGroupAttachmentSource,rootGroupAttachmentAudience,
  rootAttachmentProgress,retryRootAttachmentSelection,removeRootAttachmentSelection,controlRootAttachment} from '../../services/identity/rootAttachmentRuntime';
export {attachmentDigest} from '../../services/identity/attachmentProtocol';
export {createRootVoiceRecorder,rootVoiceRecordingActive} from '../../services/identity/rootVoiceRecorder';
export {startRootCallLease,stopRootCallLease,markRootCallConnected,rootCallMayRunBackground} from '../../services/identity/rootCallLifetime';

export {rootMessageStatus,deliveryStatusIcon,deliveryStatusLabel} from '../../services/identity/rootMessageStatus';
