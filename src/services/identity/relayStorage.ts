import type {AttachmentManifest,AttachmentChunk,AttachmentReceipt} from './attachmentProtocol.ts';
import type {CustodyEnvelope,CustodyReceipt} from './custodyProtocol.ts';
import type {GroupCustodyPayload} from './groupCustodyProtocol.ts';

/** Relay-only persistence ports. No private file key, own-chat ledger or network.
 * Services validate admission/expiry/receipts; adapters atomically persist rows.
 * Transactions serialize across all instances sharing the same database. */
export interface AttachmentCustodyRow {digest:string;manifest:AttachmentManifest;received:number;receipt:AttachmentReceipt|null}
export interface AttachmentTransaction {
 rows():Promise<AttachmentCustodyRow[]>;
 save(row:AttachmentCustodyRow):Promise<void>;
 chunk(digest:string,index:number):Promise<AttachmentChunk|null>;
 saveChunk(digest:string,chunk:AttachmentChunk):Promise<void>;
 eraseChunks(digest:string):Promise<void>;
 erase(digest:string):Promise<void>;
}
/** Metadata and ciphertext writes/deletes must commit atomically or throw, serialized per database. */
export interface AttachmentStore {transaction<T>(work:(tx:AttachmentTransaction)=>Promise<T>):Promise<T>}

export interface GroupCustodyRow {
 sender:string;id:string;digest:string;expires:number;accepted:boolean;stagedUntil:number;source?:string;replicated?:string;
 payload:GroupCustodyPayload|null;
 recipients:{id:string;recipient:string;recipientDevice:string;digest:string;grant:CustodyEnvelope|null;receipt:CustodyReceipt|null;consumed:boolean}[];
}
export interface GroupCustodyStore {revision?():number|string;transaction<T>(change:(rows:GroupCustodyRow[])=>T):Promise<T>}

export interface CustodyRow { sender: string; recipient: string; id: string; recipientDevice: string;
  expires: number; digest: string; packet: CustodyEnvelope | CustodyReceipt | null }
/** Store must serialize transactions across ALL instances sharing the same owner. Commit or throw. */
export interface CustodyStore { revision?():number|string; read?<T>(inspect:(rows:readonly CustodyRow[])=>T):Promise<T>; limits?: CustodyLimits; transaction<T>(change: (rows: CustodyRow[]) => T): Promise<T> }

export interface CustodyLimits { live: number; rows: number; bytes: number; perSender: number; perRecipient: number }