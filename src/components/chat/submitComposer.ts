/** Clear the submitted draft promptly; a failed save must not erase newer typing. */
export async function submitComposer(value:string,update:(next:(current:string)=>string)=>void,commit:()=>Promise<unknown>){
 update(current=>current===value?'':current);
 try{await commit();}catch(error){update(current=>current===''?value:current);throw error;}
}
