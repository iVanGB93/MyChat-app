import type {CustodyReceipt} from './custodyProtocol';

/** Confirm the recipient's locally generated receipt using the existing idempotent
 * relay operation. Direct-delivery handlers must not await this reverse request:
 * their response must leave the ordered connection first. */
export function createReceiptConfirmation(d:{owner():string|null;now():number;request(peer:string,raw:string):Promise<string|null>;accepted(sender:string,id:string):void}){
 const accepted=new Map<string,number>(),pending=new Map<string,Promise<void>>();let stopped=false;
 const key=(r:CustodyReceipt)=>JSON.stringify([r.recipient,r.sender,r.id]);
 return {
  confirm(receipt:CustodyReceipt,relay:string,group?:string):Promise<void>{
   if(stopped||d.owner()!==receipt.recipient||receipt.expires<=d.now())return Promise.resolve();
   const id=key(receipt),attempt=JSON.stringify([id,relay,group??null]);
   if((accepted.get(id)??0)>d.now())return Promise.resolve();
   const previous=pending.get(attempt);if(previous)return previous;
   const work=Promise.resolve().then(async()=>{
    if(stopped||d.owner()!==receipt.recipient||receipt.expires<=d.now())return;
    const reply=JSON.parse(await d.request(relay,JSON.stringify(group?{operation:'group-receipt',id:group,packet:receipt}:{operation:'receipt',packet:receipt}))??'{}');
    if(reply.status!=='accepted'||stopped||d.owner()!==receipt.recipient||receipt.expires<=d.now())return;
    for(const [k,until] of accepted)if(until<=d.now())accepted.delete(k);
    if(accepted.size>=1024)accepted.delete(accepted.keys().next().value!);
    accepted.set(id,receipt.expires);
    try{d.accepted(receipt.sender,receipt.id);}catch{/* Observation cannot undo acceptance. */}
   }).catch(()=>{/* Normal durable relay polling can retry after disconnect/rejection. */});
   pending.set(attempt,work);void work.finally(()=>{if(pending.get(attempt)===work)pending.delete(attempt);});return work;
  },
  complete:(sender:string,id:string)=>!stopped&&(accepted.get(JSON.stringify([d.owner(),sender,id]))??0)>d.now(),
  stop(){stopped=true;accepted.clear();pending.clear();},
 };
}
