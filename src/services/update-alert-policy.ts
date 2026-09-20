/** Old/undated repair traffic must still sync, but must not look like a new alert.
 * The mutation timestamp (not the original message date) allows new reactions
 * to old messages. The age limit also protects against pruned dedupe ledgers.
 */
export function isRecentAlertUpdate(update: {
  id?: string;
  changes: Record<string, unknown>;
}, now = Date.now()): boolean {
  if (!update.id) return false;
  const timestamp = Date.parse(String(update.changes.updated_at ?? ''));
  return Number.isFinite(timestamp) && now - timestamp <= 24 * 60 * 60 * 1000
    && timestamp - now <= 5 * 60 * 1000;
}
