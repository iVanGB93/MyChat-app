// Keep the scope inside data: older deployed relays forward data unchanged.
// Older clients send unscoped signals and remain supported during rollout.
export function scopeCallSignal(data: Record<string, unknown>, callId: string) {
  return { ...data, axonic_call_id: callId };
}

export function readCallSignal(data: unknown, callId: string): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const { axonic_call_id, ...signal } = data as Record<string, unknown>;
  if (axonic_call_id != null && String(axonic_call_id) !== callId) return null;
  return signal;
}
