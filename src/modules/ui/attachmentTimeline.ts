import type {AttachmentSelection} from '../media';
export type PreparationRow={key:string;at:number;preparation:AttachmentSelection;message?:never;call?:never};
/** Pending media occupies its final timeline key and position, never the list header. */
export function attachmentTimeline<T extends {key:string;at:number}>(rows:T[],selections:AttachmentSelection[],key:(s:AttachmentSelection)=>string):(T|PreparationRow)[]{
 const seen=new Set(rows.map(row=>row.key));
 const pending:PreparationRow[]=[];
 for(const selection of selections){const id=key(selection);if(seen.has(id))continue;seen.add(id);pending.push({key:id,at:selection.createdAt??0,preparation:selection});}
 return [...rows,...pending].sort((a,b)=>b.at-a.at||a.key.localeCompare(b.key));
}
