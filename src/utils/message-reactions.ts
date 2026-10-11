/** One badge per emoji; a participant contributes at most one reaction. */
export function messageReactionBadges(reactions:ReadonlyArray<{author:string;text:string}>,owner?:string){
 const badges=new Map<string,{emoji:string;count:number;mine:boolean}>(),authors=new Set<string>();
 for(const r of reactions){if(!r.text||authors.has(r.author))continue;authors.add(r.author);
  const badge=badges.get(r.text)??{emoji:r.text,count:0,mine:false};badge.count++;badge.mine ||= r.author===owner;badges.set(r.text,badge);
 }
 return [...badges.values()];
}
