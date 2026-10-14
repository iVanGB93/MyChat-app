import {validAccountId} from './identityProtocol.ts';
import {profileCount,profilePackets,profilePartId,validOwnProfile,type OwnProfile,type ProfileDelivery} from './rootProfileProtocol.ts';
import type {RootChatState} from './rootChatTypes.ts';
export function profileAudience(s:RootChatState,owner:string){
 const peers=new Set(s.contacts.filter(c=>c.accepted&&!c.blocked&&!s.hiddenChats?.includes(c.account)).map(c=>c.account));
 for(const g of s.groups??[])if(g.accepted&&!g.blocked&&g.members.includes(owner))for(const p of g.members)if(p!==owner)peers.add(p);
 return [...peers].filter(p=>!s.contacts.some(c=>c.account===p&&c.blocked)).slice(0,500);
}
export function syncProfileAudience(s:RootChatState,owner:string){
 const peers=profileAudience(s,owner).filter(p=>s.profilePeers?.includes(p));
 if(s.ownProfile)s.profileDeliveries=peers.map(peer=>s.profileDeliveries?.find(p=>p.peer===peer)??{peer,acked:[]});
 s.profileRequests=s.profileRequests?.filter(p=>peers.includes(p.peer));
}
export function validProfileStorage(s:RootChatState,owner:string){
 if(s.profileRequests?.some(p=>p.target!==undefined&&(!p.target||Object.keys(p.target).sort().join(',')!=='hash,revision'||!Number.isSafeInteger(p.target.revision)||p.target.revision<1||typeof p.target.hash!=='string'||!/^[a-f0-9]{64}$/.test(p.target.hash))))return false;
 if(s.profileOfferPeers!==undefined&&(!Array.isArray(s.profileOfferPeers)||s.profileOfferPeers.length>500||s.profileOfferPeers.some(p=>!validAccountId(p)||p===owner)))return false;
 if(s.profileDeliveries?.some(p=>p.requested!==undefined&&typeof p.requested!=='boolean'))return false;
 return (s.profilePeers===undefined||Array.isArray(s.profilePeers)&&s.profilePeers.length<=500&&s.profilePeers.every(p=>validAccountId(p)&&p!==owner))&&(s.ownProfile===undefined||validOwnProfile(s.ownProfile,owner))&&
 (s.profileDeliveries===undefined||!!s.ownProfile&&Array.isArray(s.profileDeliveries)&&s.profileDeliveries.length<=500&&new Set(s.profileDeliveries.map(p=>p.peer)).size===s.profileDeliveries.length&&s.profileDeliveries.every(p=>validAccountId(p.peer)&&p.peer!==owner&&Array.isArray(p.acked)&&p.acked.length<=profileCount(s.ownProfile!.manifest)&&new Set(p.acked).size===p.acked.length&&p.acked.every(i=>Number.isSafeInteger(i)&&i>=0&&i<profileCount(s.ownProfile!.manifest))))&&
 (s.profileRequests===undefined||Array.isArray(s.profileRequests)&&s.profileRequests.length<=500&&s.profileRequests.every(p=>validAccountId(p.peer)&&p.peer!==owner&&/^[a-f0-9]{64}$/.test(p.id)&&(p.known===null||/^[a-f0-9]{64}$/.test(p.known))));
}
export function pendingProfiles(s:RootChatState,owner:string){
 const peers=profileAudience(s,owner).filter(p=>s.profilePeers?.includes(p));
 return [...(s.profileRequests??[]).filter(p=>peers.includes(p.peer)).map(p=>({peer:p.peer,id:p.id,raw:JSON.stringify(p.target?['axonic-avatar-fetch-v1',p.peer,p.id,{known:p.known,...p.target}]:['axonic-avatar-request-v1',p.peer,p.id,p.known])})),
 ...(!s.ownProfile?[]:(s.profileDeliveries??[]).filter(p=>peers.includes(p.peer)&&(!s.profileOfferPeers?.includes(p.peer)||p.requested)).flatMap(p=>profilePackets(owner,p.peer,s.ownProfile!,p.acked)))];
}
export type {OwnProfile,ProfileDelivery};

export function knownProfileReceipt(s:RootChatState,owner:string,peer:string,id:string){
 if(s.profileRequests?.some(p=>p.peer===peer&&p.id===id))return true;
 const m=s.ownProfile?.manifest;if(!m||!s.profileDeliveries?.some(p=>p.peer===peer))return false;
 for(let i=0;i<profileCount(m);i++)if(profilePartId(owner,peer,m,i)===id)return true;return false;
}
