/** Index one progress snapshot without changing first-match or digest semantics.
 * Compute the manifest digest once per lookup, not once per queued job. Keep
 * no manifest cache: changed descriptors must always use their current digest.
 */
export function createAttachmentProgressLookup<T extends {digest:string}, M>(
 jobs:readonly T[], digest:(manifest:M)=>string,
):(manifest:M)=>T|undefined {
 const byDigest=new Map<string,T>();
 for(const job of jobs)if(!byDigest.has(job.digest))byDigest.set(job.digest,job);
 return manifest=>byDigest.size?byDigest.get(digest(manifest)):undefined;
}
