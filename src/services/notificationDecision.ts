import type { NotificationPayload } from './axionTypes';

export type NotificationDecisionReason =
  | 'not_target_event'
  | 'eligible'
  | 'app_active'
  | 'app_inactive'
  | 'already_in_call'
  | 'viewing_room'
  | 'room_muted'
  | 'push_floor';

export interface NotificationDecision {
  allow: boolean;
  reason: NotificationDecisionReason;
}

export interface NotificationDecisionContext {
  appActive: boolean;
  activeRoomId?: string | null;
  mutedRooms?: Record<string, boolean>;
  activeCall?: {
    callId: string;
    state: string;
  } | null;
}

function roomIdFromPayload(payload: NotificationPayload): string {
  return String(payload.room_id ?? '');
}

function isViewingRoom(
  payload: NotificationPayload,
  context: NotificationDecisionContext,
): boolean {
  if (payload.event !== 'new_message' && payload.event !== 'message_update') return false;
  return !!context.activeRoomId && context.activeRoomId === roomIdFromPayload(payload);
}

function isMutedRoom(
  payload: NotificationPayload,
  context: NotificationDecisionContext,
): boolean {
  if (payload.event !== 'new_message') return false;
  return !!context.mutedRooms?.[roomIdFromPayload(payload)];
}

function isSameActiveCall(
  payload: NotificationPayload,
  context: NotificationDecisionContext,
): boolean {
  if (payload.event !== 'incoming_call') return false;
  const active = context.activeCall;
  if (!active || active.state === 'ended') return false;
  return !!payload.call_id && active.callId === String(payload.call_id);
}

export function decideIncomingCallInApp(
  payload: NotificationPayload,
  context: NotificationDecisionContext,
): NotificationDecision {
  if (payload.event !== 'incoming_call') return { allow: false, reason: 'not_target_event' };
  if (isSameActiveCall(payload, context)) return { allow: false, reason: 'already_in_call' };
  if (!context.appActive) return { allow: false, reason: 'app_inactive' };
  return { allow: true, reason: 'eligible' };
}

export function decideLocalIncomingCallNotification(
  payload: NotificationPayload,
  context: NotificationDecisionContext,
): NotificationDecision {
  if (payload.event !== 'incoming_call') return { allow: false, reason: 'not_target_event' };
  if (isSameActiveCall(payload, context)) return { allow: false, reason: 'already_in_call' };
  if (context.appActive) return { allow: false, reason: 'app_active' };
  return { allow: true, reason: 'eligible' };
}

export function decideInAppMessageToast(
  payload: NotificationPayload,
  context: NotificationDecisionContext,
): NotificationDecision {
  if (!context.appActive) return { allow: false, reason: 'app_inactive' };

  if (payload.event === 'new_message') {
    if (isViewingRoom(payload, context)) return { allow: false, reason: 'viewing_room' };
    if (isMutedRoom(payload, context)) return { allow: false, reason: 'room_muted' };
    return { allow: true, reason: 'eligible' };
  }

  if (payload.event === 'message_update') {
    if (isViewingRoom(payload, context)) return { allow: false, reason: 'viewing_room' };
    return { allow: true, reason: 'eligible' };
  }

  return { allow: false, reason: 'not_target_event' };
}

export function decideLocalMessageNotification(
  payload: NotificationPayload,
  context: NotificationDecisionContext,
): NotificationDecision {
  if (payload.event !== 'new_message') return { allow: false, reason: 'not_target_event' };
  if (context.appActive) return { allow: false, reason: 'app_active' };
  if (isViewingRoom(payload, context)) return { allow: false, reason: 'viewing_room' };
  if (isMutedRoom(payload, context)) return { allow: false, reason: 'room_muted' };
  // The FCM headless handler renders the server push floor for background or
  // killed-process recipients. Only use the Axion fallback when no push was sent.
  if (payload.push_floor) return { allow: false, reason: 'push_floor' };
  return { allow: true, reason: 'eligible' };
}
