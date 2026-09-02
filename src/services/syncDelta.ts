export interface MessageDigestEntry {
  id: string;
  updated_at: string;
  revision: number;
  is_deleted: boolean;
}

function compareVersion(a: MessageDigestEntry, b: MessageDigestEntry): number {
  const time = a.updated_at.localeCompare(b.updated_at);
  if (time !== 0) return time;
  return Number(a.revision || 0) - Number(b.revision || 0);
}

/** Identify absent rows and rows whose peer mutation is newer than ours. */
export function partitionRemoteDigest(
  remote: MessageDigestEntry[],
  local: MessageDigestEntry[],
): { missingIds: string[]; staleIds: string[] } {
  const localById = new Map(local.map((entry) => [entry.id, entry]));
  const missingIds: string[] = [];
  const staleIds: string[] = [];
  const seen = new Set<string>();

  for (const entry of remote) {
    if (!entry.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const existing = localById.get(entry.id);
    if (!existing) {
      missingIds.push(entry.id);
    } else if (compareVersion(entry, existing) > 0) {
      staleIds.push(entry.id);
    }
  }

  return { missingIds, staleIds };
}
