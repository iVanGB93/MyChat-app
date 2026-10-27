import type {IdentityPeer} from './identityClient.ts';

/** An already authenticated stream lane. It cannot discover peers or persist jobs.
 * The connection provider owns readiness/credit/session lifetime. */
export interface AttachmentLane {
 live():boolean;ready():Promise<void>;send(data:string|Uint8Array):void;close():void;
 credit(value:number,authorize:boolean):Promise<void>;
 listen(message:(data:unknown)=>void,closed:()=>void):void;
}
export interface AttachmentStreams {
 available(account:string,device:string):boolean;
 unavailableReason?(account:string,device:string):string;
 /** Bounded authenticated upgrade hint, not proof that a route is ready. */
 request?(account:string,device:string):boolean;
 open(account:string,device:string):AttachmentLane;
 listen(handler:(account:string,device:string,lane:AttachmentLane)=>boolean):()=>void;
}
/** Existing authenticated WSS session; instance pins every send to that session. */
export interface WssStreamNetwork {
 peer(account:string):IdentityPeer|null;
 send(account:string,instance:string,raw:string):boolean;
 binary?(account:string,instance:string):boolean;
 sendBinary?(account:string,instance:string,raw:Uint8Array):boolean;
 request(account:string,raw:string):Promise<string|null>;
}
/** Requests/capability observations only. No ledger, discovery or storage access. */
export interface AttachmentRequests {
 peers():string[];
 request(peer:string,raw:string):Promise<string|null>;
 sharedPeers?():string[];
 bulkPeers?():string[];
 blockStreamPeers?():string[];
 uploadBatchPeers?():string[];
 batchChunks?(peer:string):number;
 batchWindow?(peer:string):number;
 bulkRequest?(peer:string,raw:string):Promise<string|null>;
}
