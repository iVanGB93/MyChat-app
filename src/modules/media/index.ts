/** Attachment and voice application API; file ownership remains in the platform adapter. */
export {controlRootAttachment} from '../../services/identity/rootAttachmentRuntime';
export type {Selection as AttachmentSelection} from '../../services/identity/rootAttachmentSelections';
export {retryRootAttachmentCaption,queueRootAttachmentBatch,queueRootAttachmentSource,queueRootGroupAttachmentSource,rootGroupAttachmentAudience,rootAttachmentProgress,retryRootAttachmentSelection,removeRootAttachmentSelection} from '../../services/identity/rootAttachmentSelections';
export {attachmentDigest,attachmentContentDigest,attachmentBlockBytes} from '../../services/identity/attachmentProtocol';
export {retiredAttachment} from '../../services/identity/retiredAttachment';
export {createRootVoiceRecorder,rootVoiceRecordingActive,subscribeRootVoiceRecording} from '../../services/identity/rootVoiceRecorder';
export {subscribeAttachmentChanges,subscribeAttachmentContentChanges} from '../../services/identity/attachmentChanges';

export {backgroundUploadScheduled} from '../../services/identity/backgroundUploadStatus';

export {resendExpiredRootAttachment} from '../../services/identity/rootExpiredAttachment';
