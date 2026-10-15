import {validAccountId} from './identityProtocol.ts';

/** Local authenticated observations, never a claim about unobserved network hops.
 * Receipt paths do not establish the path taken by the original payload. */
export type DeliveryEvidence={version:1;method:'peer'|'custody'|'mixed';scope:'payload'|'receipt';relays:string[];at:number;partial:boolean};
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
