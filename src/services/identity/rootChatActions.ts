import type { RootChatReply, RootChatState, RootChatMessage } from './rootChatTypes.ts';
import type {RootActionKind,RootChatAction} from './rootChatActionTypes.ts';
export type {RootActionKind,RootChatAction} from './rootChatActionTypes.ts';
export const ROOT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
export const actionFamily = (kind: RootActionKind) => kind === 'edit' || kind === 'delete' ? 'content' : kind;
export const actionBody = (a: RootChatAction) => ({ target: a.target, kind: a.kind, revision: a.revision, text: a.text });
export const sameTarget = (a: RootChatReply, b: RootChatReply) => a.id === b.id && a.author === b.author;
export const sameAction = (a: RootChatAction, b: RootChatAction) => JSON.stringify(actionBody(a)) === JSON.stringify(actionBody(b));
export function validRootAction(a: RootChatAction, owner: string, peer: string): boolean {
 const actor = a?.direction === 'outgoing' ? owner : peer;
 return !!a && /^[a-f0-9]{64}$/.test(a.id) && a.peer === peer && ['incoming','outgoing'].includes(a.direction)
  && !!a.target && Object.keys(a.target).length === 2 && /^[a-f0-9]{64}$/.test(a.target.id) && [owner,peer].includes(a.target.author)
  && ['edit','delete','reaction','read'].includes(a.kind) && Number.isSafeInteger(a.revision) && a.revision >= 1 && a.revision <= 1000000
  && typeof a.text === 'string' && Number.isSafeInteger(a.at) && ['pending','delivered'].includes(a.status)
  && (a.kind === 'edit' ? a.target.author === actor && !!a.text.trim() && new TextEncoder().encode(a.text).length <= 1600
    : a.kind === 'delete' ? a.target.author === actor && a.text === ''
    : a.kind === 'read' ? a.target.author !== actor && a.text === '' && a.revision === 1
    : a.text === '' || ROOT_REACTIONS.includes(a.text));
}
export const encodeRootAction = (a: RootChatAction) => JSON.stringify(['axonic-root-action-v1',a.peer,a.id,actionBody(a)]);
/** Keep the immutable original payload for retries; derive local presentation from authenticated events. */
export function rootChatView(owner: string, state: RootChatState): RootChatState {
 return {...state,messages:state.messages.map(m => {
  
  const author = m.direction === 'outgoing' ? owner : m.peer;
  const events = m.group?(state.groupActions??[]).filter(a=>a.group.id===m.group!.id&&sameTarget(a.target,{id:m.group!.messageId,author})):(state.actions??[]).filter(a=>a.peer===m.peer&&sameTarget(a.target,{id:m.id,author}));
  const deleted = events.some(a => a.kind === 'delete');
  const edit = events.filter(a => a.kind === 'edit').sort((a,b) => b.revision-a.revision)[0];
  const choices = new Map<string,(typeof events)[number]>();
  for (const a of events.filter(a => a.kind === 'reaction')) {
   const actor = a.direction === 'outgoing' ? owner : a.peer, old = choices.get(actor);
   if (!old || old.revision < a.revision) choices.set(actor,a);
  }
  return {...m,text:deleted?'Message deleted':!m.attachment&&edit?edit.text:m.text,deleted,edited:!!edit&&!deleted,
   read:m.group?m.read:events.some(a => a.kind === 'read'),reactions:deleted?[]:[...choices].filter(([,a]) => a.text).map(([author,a]) => ({author,text:a.text}))} as RootChatMessage;
 })};
}
