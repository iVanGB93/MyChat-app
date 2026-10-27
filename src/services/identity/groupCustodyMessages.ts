/** Share only the common group body; retain existing wire IDs and per-recipient
 * signed media manifests so the normal ledger remains the authority. */
export function splitGroupCustodyMessage(raw:string):{text:string;metadata:string;group:string}|null{
 try{const m=JSON.parse(raw);if(!Array.isArray(m)||![4,5].includes(m.length)||!['axonic-root-group-text-v1','axonic-root-group-attachment-v1','axonic-root-group-action-v1'].includes(m[0])||!m[3]?.group?.messageId)return null;
 const body=structuredClone(m[3]);let manifest=null;
 if(m[0]==='axonic-root-group-attachment-v1'){if(body.descriptor?.manifest?.version!==4||!body.descriptor.manifest.shared)return null;manifest=body.descriptor.manifest;delete body.descriptor.manifest;}
 return {text:JSON.stringify([m[0],body,...(m.length===5?[m[4]]:[])]),metadata:JSON.stringify(manifest),group:m[3].group.id+':'+m[3].group.messageId};
 }catch{return null;}
}
export function joinGroupCustodyMessage(text:string,metadata:string,recipient:string,id:string){
 const m=JSON.parse(text),manifest=JSON.parse(metadata);
 if(!Array.isArray(m)||![2,3].includes(m.length)||!['axonic-root-group-text-v1','axonic-root-group-attachment-v1','axonic-root-group-action-v1'].includes(m[0])||!m[1]?.group)throw Error('Invalid shared group body');
 if(m[0]==='axonic-root-group-attachment-v1'){
  if(!manifest||manifest.recipient!==recipient||manifest.id!==id||manifest.version!==4||!manifest.shared||!m[1].descriptor)throw Error('Wrong group attachment grant');
  m[1].descriptor.manifest=manifest;
 }else if(manifest!==null)throw Error('Unexpected group metadata');
 return JSON.stringify([m[0],recipient,id,m[1],...(m.length===3?[m[2]]:[])]);
}
