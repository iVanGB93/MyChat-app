import {createChangeSignal} from './changeSignal';
const signal=createChangeSignal(250);
const content=createChangeSignal(250);
export const subscribeAttachmentChanges=signal.subscribe;
export const attachmentChanged=signal.changed;
/** File availability changes are separate from chunk-progress checkpoints. */
export const subscribeAttachmentContentChanges=content.subscribe;
export const attachmentContentChanged=()=>{signal.changed();content.changed();};
