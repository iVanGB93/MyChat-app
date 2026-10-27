import type {AttachmentJob} from './attachmentTypes.ts';
import type {AttachmentChunk} from './attachmentProtocol.ts';
import type {DirectAttachmentExpectation} from './directAttachmentStream.ts';
import type {AttachmentRequests} from './attachmentConnections.ts';

/** Own resumable jobs, including private descriptors. Never exposed to custodians. */
export interface AttachmentJobStore {
 /** Archive terminal work without deleting its receipt/history/file. */
 retire?(owner:string,current:()=>boolean):Promise<void>;
 list(owner:string):Promise<AttachmentJob[]>;
 get(owner:string,digest:string):Promise<AttachmentJob|null>;
 isCurrent?(owner:string,digest:string,revision:number):Promise<boolean>;
 /** Compare-and-set: null creates; every mutation advances revision. */
 save(job:AttachmentJob,expected:number|null,current:()=>boolean):Promise<boolean>;
}
/** Own file bytes only, not job metadata or relay ciphertext custody. */
export interface AttachmentFileStore {
 readChunk(job:AttachmentJob,index:number):Promise<AttachmentChunk>;
 readChunks?(job:AttachmentJob,index:number,count:number):Promise<AttachmentChunk[]>;
 /** Idempotent index writes; resolve only after bytes are durable. */
 writeChunk(job:AttachmentJob,index:number,plain:Uint8Array,current:()=>boolean):Promise<void>;
 writeChunks?(job:AttachmentJob,index:number,plain:Uint8Array[],current:()=>boolean):Promise<void>;
 /** Read back size/checksum before atomic publication; never trust a stream result. */
 commitFile(job:AttachmentJob,current:()=>boolean):Promise<void>;
}
export interface AttachmentTransferStorage {jobs:AttachmentJobStore;files:AttachmentFileStore}
/** Transfer-facing connection port. Network owns sessions; worker owns policy.
 * Optional direct streams may stage complete bytes but cannot publish a chat
 * receipt. They must respect the supplied lease and discard partial files. */
export interface AttachmentTransferConnections extends AttachmentRequests {
 directStream?(job:AttachmentJob,live:()=>Promise<boolean>,expected:DirectAttachmentExpectation):Promise<boolean|'unavailable'>;
 serveStream?(job:AttachmentJob,live:()=>Promise<boolean>,wssId?:string):Promise<boolean>;
}
