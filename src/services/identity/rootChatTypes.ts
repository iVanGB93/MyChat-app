import type {AttachmentDescriptor} from './attachmentTransfer.ts';
import type {RootChatAction} from './rootChatActionTypes.ts';
import type {RootGroup,RootGroupContext,RootGroupPacket,RootGroupAction} from './rootGroupTypes.ts';
export type RootChatReply={id:string;author:string};
export type RootChatMessage={id:string;peer:string;direction:'incoming'|'outgoing';text:string;at:number;status:'pending'|'delivered';attachment?:AttachmentDescriptor;descriptorDelivered?:boolean;networkStoredUntil?:number;attachmentStoredUntil?:number;reply?:RootChatReply;edited?:boolean;deleted?:boolean;read?:boolean;reactions?:{author:string;text:string}[];group?:RootGroupContext};
export type RootChatContact={account:string;alias:string;blocked:boolean;accepted:boolean;muted?:boolean};
export type RootChatState={version:1;messages:RootChatMessage[];contacts:RootChatContact[];hiddenChats?:string[];removedMessages?:{peer:string;id:string;direction:'incoming'|'outgoing'}[];imports?:string[];actions?:RootChatAction[];groupActions?:RootGroupAction[];groups?:RootGroup[];groupPackets?:RootGroupPacket[];groupSeen?:{peer:string;id:string;raw:string}[]};
