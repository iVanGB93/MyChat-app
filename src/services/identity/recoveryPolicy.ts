/** Local scheduling preferences, never advertised as trust or delivery evidence. */
export const DEFAULT_RECOVERY_POLICY = Object.freeze({ pollsPerMinute: 60, custodyFramesPerMinute: 512 });
export type RecoveryPolicy = typeof DEFAULT_RECOVERY_POLICY;
let policy: RecoveryPolicy = {...DEFAULT_RECOVERY_POLICY};
export const recoveryPolicy = () => policy;
export function setRecoveryPolicy(next: RecoveryPolicy) {
  if (!Number.isInteger(next.pollsPerMinute) || next.pollsPerMinute < 30 || next.pollsPerMinute > 90
    || !Number.isInteger(next.custodyFramesPerMinute) || next.custodyFramesPerMinute < 512 || next.custodyFramesPerMinute > 2048)
    throw Error('Invalid recovery settings');
  policy = Object.freeze({...next});
}
// Shared by all sockets to an identity: reconnecting must not reset the budget.
// Only polls spend credits. Delivery acknowledgements and deposits retain priority.
const budgets = new Map<string, {at: number; credits: number}>();
export function reserveRecoveryPoll(owner: string, peer: string, now: number): number {
  const key = owner + ':' + peer;
  let entry = budgets.get(key);
  if (!entry) {
    if (budgets.size >= 256) budgets.delete(budgets.keys().next().value!);
    entry = {at: now, credits: 4}; budgets.set(key, entry);
  }
  const rate = policy.pollsPerMinute / 60000;
  entry.credits = Math.min(4, entry.credits + Math.max(0, now - entry.at) * rate);
  entry.at = Math.max(entry.at, now);
  if (entry.credits < 1) return Math.ceil((1 - entry.credits) / rate);
  entry.credits--; return 0;
}
