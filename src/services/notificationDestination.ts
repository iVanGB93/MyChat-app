export type NotificationDestination =
  | { type: 'message'; roomId: string; roomName: string; otherUserId?: number }
  | {
      type: 'call';
      callId: string;
      callerName: string;
      callerId: number;
      callType: 'voice' | 'video';
      roomName: string;
    };

function boolValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** Normalize Notifee, Expo and raw-FCM key styles into one navigation shape. */
export function parseNotificationDestination(
  raw: Record<string, any> | null | undefined,
): NotificationDestination | null {
  if (!raw) return null;
  const type = String(raw.type ?? '');
  if (type === 'new_message') {
    const roomId = String(raw.roomId ?? raw.room_id ?? '');
    if (!roomId) return null;
    const roomName = String(raw.roomName ?? raw.room_name ?? '');
    const senderName = String(raw.senderName ?? raw.sender_name ?? raw.sender ?? raw.title ?? '');
    const roomType = String(raw.roomType ?? raw.room_type ?? '');
    const isGroup = boolValue(raw.isGroup ?? raw.is_group)
      || roomType === 'group'
      || (!!roomName && !!senderName && roomName !== senderName);
    const senderId = Number(raw.senderId ?? raw.sender_id ?? 0);
    return {
      type: 'message',
      roomId,
      roomName,
      ...(!isGroup && Number.isFinite(senderId) && senderId > 0
        ? { otherUserId: senderId }
        : {}),
    };
  }

  if (type === 'incoming_call') {
    const callId = String(raw.callId ?? raw.call_id ?? '');
    if (!callId) return null;
    return {
      type: 'call',
      callId,
      callerName: String(raw.callerName ?? raw.caller_name ?? raw.caller ?? 'Unknown'),
      callerId: Number(raw.callerId ?? raw.caller_id ?? 0),
      callType: raw.callType === 'video' || raw.call_type === 'video' ? 'video' : 'voice',
      roomName: String(raw.roomName ?? raw.room_name ?? ''),
    };
  }
  return null;
}

