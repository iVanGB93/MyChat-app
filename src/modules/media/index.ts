/** Attachment and voice application API; file ownership remains in the platform adapter. */
export {controlRootAttachment} from '../../services/identity/rootAttachmentRuntime';
export {queueRootAttachmentBatch,queueRootAttachmentSource,queueRootGroupAttachmentSource,rootGroupAttachmentAudience,rootAttachmentProgress,retryRootAttachmentSelection,removeRootAttachmentSelection} from '../../services/identity/rootAttachmentSelections';
export {attachmentDigest,attachmentBlockBytes} from '../../services/identity/attachmentProtocol';
export {createRootVoiceRecorder,rootVoiceRecordingActive} from '../../services/identity/rootVoiceRecorder';
export {subscribeAttachmentChanges,subscribeAttachmentContentChanges} from '../../services/identity/attachmentChanges';
