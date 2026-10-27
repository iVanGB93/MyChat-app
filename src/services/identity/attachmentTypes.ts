import type {AttachmentManifest,AttachmentReceipt} from './attachmentProtocol.ts';
import type {DeliveryEvidence} from './deliveryEvidence.ts';

/** Private chat metadata. Never send this descriptor to a custodian outside encrypted chat. */
export interface AttachmentDescriptor {manifest:AttachmentManifest;key:string;checksum:string;name:string;mime:string;caption?:string}
export type AttachmentPhase='queued'|'uploading'|'downloading'|'confirming'|'complete'|'expired'|'cancelled';
export interface AttachmentJob {
 version:1;owner:string;digest:string;direction:'outgoing'|'incoming';descriptor:AttachmentDescriptor;
 revision:number;phase:AttachmentPhase;cursor:number;relay:string|null;next:number;failures:number;receipt:AttachmentReceipt|null;
 custodians:string[];acknowledged:string[];
 /** Verified byte sources, not offered custodians. Missing means legacy/unknown prefix. */
 receivedSources?:string[];sourceCoverage?:boolean;delivery?:DeliveryEvidence;
}
