import {validAccountId} from './identityProtocol.ts';

/** Local authenticated observations, never a claim about unobserved network hops.
 * Receipt paths do not establish the path taken by the original payload. */
export type DeliveryEvidence={version:1;method:'peer'|'custody'|'mixed';scope:'payload'|'receipt';relays:string[];at:number;partial:boolean};
/** Recipient-attested application sources, not Internet routers or a reward proof. */
export type ReceivedRoute={sources:string[];partial:boolean};
export function validReceivedRoute(value:unknown):value is ReceivedRoute {
 const r=value as ReceivedRoute;return !!r&&Object.keys(r).sort().join(',')==='partial,sources'&&typeof r.partial==='boolean'&&Array.isArray(r.sources)&&r.sources.length>0&&r.sources.length<=10&&r.sources.every(validAccountId)&&new Set(r.sources).size===r.sources.length;
}
/** Call only after verifying the receipt and its optional route signature. */
export function receiptDeliveryEvidence(receipt:{route?:ReceivedRoute},sender:string,at:number,relay?:string):DeliveryEvidence {
 if(!receipt.route)return deliveryEvidence('receipt',at,relay);
 const relays=receipt.route.sources.filter(source=>source!==sender);
 return {version:1,scope:'payload',method:relays.length?(receipt.route.sources.includes(sender)?'mixed':'custody'):'peer',relays,at,partial:receipt.route.partial};
}
export function validDeliveryEvidence(value:unknown):value is DeliveryEvidence {
 const e=value as DeliveryEvidence;
 return !!e&&e.version===1&&['peer','custody','mixed'].includes(e.method)&&['payload','receipt'].includes(e.scope)
  &&Number.isSafeInteger(e.at)&&e.at>=0&&e.at<=8640000000000000&&typeof e.partial==='boolean'
  &&Array.isArray(e.relays)&&e.relays.length<=10&&e.relays.every(validAccountId)&&new Set(e.relays).size===e.relays.length
  &&(e.method!=='peer'||e.relays.length===0);
}
export function deliveryEvidence(scope:DeliveryEvidence['scope'],at:number,relay?:string):DeliveryEvidence {
 return {version:1,method:relay===undefined?'peer':'custody',scope,relays:relay?[relay]:[],at,partial:relay===''};
}
