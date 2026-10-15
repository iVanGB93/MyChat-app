import type {OwnProfile,ProfileDelivery,ProfileRequest} from './rootProfileProtocol.ts';
import type {AttachmentDescriptor} from './attachmentTransfer.ts';
import type {RootChatAction} from './rootChatActionTypes.ts';
import type {RootGroup,RootGroupContext,RootGroupPacket,RootGroupAction} from './rootGroupTypes.ts';
import type {DeliveryEvidence} from './deliveryEvidence.ts';
export type RootChatReply={id:string;author:string};
export type RootChatMessage={id:string;peer:string;direction:'incoming'|'outgoing';text:string;at:number;createdAt?:number;status:'pending'|'delivered';attachment?:AttachmentDescriptor;descriptorDelivered?:boolean;messageDelivery?:DeliveryEvidence;attachmentDelivery?:DeliveryEvidence;networkStoredUntil?:number;attachmentStoredUntil?:number;queuedAt?:number;storedAt?:number;deliveredAt?:number;readAt?:number;descriptorReceivedAt?:number;reply?:RootChatReply;edited?:boolean;deleted?:boolean;read?:boolean;reactions?:{author:string;text:string}[];group?:RootGroupContext};
export type RootChatContact={account:string;alias:string;blocked:boolean;accepted:boolean;muted?:boolean};
export type RootChatState={version:1;profileOfferPeers?:string[];groupCustodyPeers?:string[];profilePeers?:string[];ownProfile?:OwnProfile;profileDeliveries?:ProfileDelivery[];profileRequests?:ProfileRequest[];timestampPeers?:string[];messages:RootChatMessage[];contacts:RootChatContact[];hiddenChats?:string[];removedMessages?:{peer:string;id:string;direction:'incoming'|'outgoing'}[];imports?:string[];actions?:RootChatAction[];groupActions?:RootGroupAction[];groups?:RootGroup[];groupPackets?:RootGroupPacket[];groupSeen?:{peer:string;id:string;raw:string}[]};

/** Stable across recipient-specific group delivery IDs and arrival paths. */
export function compareRootMessages(a:RootChatMessage,b:RootChatMessage,owner:string){
 const aid=a.group?.messageId??a.id,bid=b.group?.messageId??b.id;
 const aa=a.direction==='outgoing'?owner:a.peer,ba=b.direction==='outgoing'?owner:b.peer;
 return a.at-b.at||(aid<bid?-1:aid>bid?1:0)||(aa<ba?-1:aa>ba?1:0);
}
export const validCreationTime=(at:unknown):at is number=>Number.isSafeInteger(at)&&Number(at)>=0&&Number(at)<=8640000000000000;
