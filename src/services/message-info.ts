export interface MessageReceipt {
  recipient_id: number; delivered: number; read: number;
  delivered_at: string | null; read_at: string | null;
}
/** Use the frozen send-time audience, never today's group membership. */
export function messageInfoRecipients(expected: number[] | null, receipts: MessageReceipt[]) {
  const byId = new Map(receipts.map((r) => [r.recipient_id, r]));
  return [...new Set(expected ?? receipts.map((r) => r.recipient_id))].filter((id) => Number.isInteger(id) && id > 0).map((id) => {
    const r = byId.get(id);
    return { id, status: r?.read ? 'Read' : r?.delivered ? 'Delivered' : 'Pending', deliveredAt: r?.delivered_at ?? null, readAt: r?.read_at ?? null };
  });
}
