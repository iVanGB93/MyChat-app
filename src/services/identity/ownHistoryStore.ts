/** One already-bound account's own history. Not a relay packet store.
 * Commit or reject; null means absent, never a failed read. Domain validation
 * and serialization ordering belong to the ledger, not to network code. */
export interface OwnHistoryStore {
 read():Promise<string|null>;
 write(raw:string):Promise<void>;
 indexed?:IndexedOwnHistory;
}

/** Selected records plus complete account policy; absent rows are not deleted. */
export type OwnHistoryScope={peer:string;ids:string[]}|{metadata:true}|{group:string;ids:string[];logicalIds:string[]}|{control:true;photoGroup?:string;photoId?:string;incomingPeer?:string;incomingId?:string}|{groupRead:string}|{deliveryIds:string[]};
export type OwnHistorySlice={raw:string;version:number;counts:Record<string,number>;bytes?:Record<string,number>};
export interface IndexedOwnHistory {
 readScope(scope:OwnHistoryScope):Promise<OwnHistorySlice>;
 writeScope(scope:OwnHistoryScope,before:OwnHistorySlice,raw:string):Promise<void>;
 readNetwork():Promise<string>;
 readAttachments():Promise<string>;
 readMedia():Promise<string>;
 readUnread(peers:string[]):Promise<string>;
 readMessage(peer:string,id:string,direction?:'incoming'|'outgoing'):Promise<string>;
 readGroup(group:string,logicalId?:string):Promise<string>;
 readId(id:string):Promise<string>;
 recordKnown(peer:string,id:string,kind:'incoming'|'outgoing'|'groupOutgoing'):Promise<boolean>;
}
