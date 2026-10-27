/** One already-bound account's own history. Not a relay packet store.
 * Commit or reject; null means absent, never a failed read. Domain validation
 * and serialization ordering belong to the ledger, not to network code. */
export interface OwnHistoryStore {
 read():Promise<string|null>;
 write(raw:string):Promise<void>;
}
