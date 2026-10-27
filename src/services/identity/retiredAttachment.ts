/** Local history only. This is not a wire decoder or an authorization check. */
export function retiredAttachment(value:unknown):boolean {
 const version=(value as {manifest?:{version?:unknown}}|null)?.manifest?.version;
 return version===1||version===2||version===3;
}
