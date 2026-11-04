import Native from '../../../modules/axonic-nearby';
export function backgroundUploadScheduled(owner:string|null){try{return !!owner&&!!Native?.attachmentUploadScheduled?.(owner);}catch{return false;}}
