export type PushData = Record<string, string>;

export function normalizePushData(value: unknown): PushData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const output: PushData = {};

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === undefined || raw === null || typeof raw === 'object') {
      continue;
    }

    output[key] = String(raw);
  }

  return output.type ? output : null;
}

export function extractPushMessageData(input: unknown): PushData | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const root = input as Record<string, any>;

  const candidates: unknown[] = [
    root,
    root.data,
    root.notification,
    root.notification?.data,
    root.notification?.request?.content?.data,
    root.request?.content?.data,
  ];

  for (const candidate of candidates) {
    const data = normalizePushData(candidate);

    if (data?.type === 'new_message') {
      return data;
    }
  }

  return null;
}