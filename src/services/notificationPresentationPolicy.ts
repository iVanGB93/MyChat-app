import { AppState } from 'react-native';
import type { AppState as StoreState } from '../store/appStore';
import type { NotificationPayload } from './notificationWsManager';

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

function isAppActive(store: StoreState | null): boolean {
  if (store) return store.appLifecycle === 'active';
  return AppState.currentState === 'active';
}

function roomIdFromPayload(payload: NotificationPayload): string {
  return String(payload.room_id ?? '');
}

function isViewingRoom(payload: NotificationPayload, store: StoreState | null): boolean {
  if (!store) return false;
  if (payload.event !== 'new_message' && payload.event !== 'message_update') return false;
  return !!store.activeRoomId && store.activeRoomId === roomIdFromPayload(payload);
}

function isMutedRoom(payload: NotificationPayload, store: StoreState | null): boolean {
  if (!store) return false;
  if (payload.event !== 'new_message') return false;
  return !!store.mutedRooms[roomIdFromPayload(payload)];
}

function isSameActiveCall(payload: NotificationPayload, store: StoreState | null): boolean {
  if (!store || payload.event !== 'incoming_call') return false;
  const active = store.activeCall;
  if (!active || active.state === 'ended') return false;
  return !!payload.call_id && active.callId === String(payload.call_id);
}

export function shouldHandleIncomingCallInApp(
  payload: NotificationPayload,
  store: StoreState | null,
): boolean {
  return decideIncomingCallInApp(payload, store).allow;
}

export function shouldShowLocalIncomingCallNotification(
  payload: NotificationPayload,
  store: StoreState | null,
): boolean {
  return decideLocalIncomingCallNotification(payload, store).allow;
}

export function shouldShowInAppMessageToast(
  payload: NotificationPayload,
  store: StoreState | null,
): boolean {
  return decideInAppMessageToast(payload, store).allow;
}

export function shouldShowLocalMessageNotification(
  payload: NotificationPayload,
  store: StoreState | null,
): boolean {
  return decideLocalMessageNotification(payload, store).allow;
}

export function decideIncomingCallInApp(
  payload: NotificationPayload,
  store: StoreState | null,
): NotificationDecision {
  if (payload.event !== 'incoming_call') return { allow: false, reason: 'not_target_event' };
  if (isSameActiveCall(payload, store)) return { allow: false, reason: 'already_in_call' };
  if (!isAppActive(store)) return { allow: false, reason: 'app_inactive' };
  return { allow: true, reason: 'eligible' };
}

export function decideLocalIncomingCallNotification(
  payload: NotificationPayload,
  store: StoreState | null,
): NotificationDecision {
  if (payload.event !== 'incoming_call') return { allow: false, reason: 'not_target_event' };
  if (isSameActiveCall(payload, store)) return { allow: false, reason: 'already_in_call' };
  if (isAppActive(store)) return { allow: false, reason: 'app_active' };
  return { allow: true, reason: 'eligible' };
}

export function decideInAppMessageToast(
  payload: NotificationPayload,
  store: StoreState | null,
): NotificationDecision {
  const appActive = isAppActive(store);
  if (!appActive) return { allow: false, reason: 'app_inactive' };

  if (payload.event === 'new_message') {
    if (isViewingRoom(payload, store)) return { allow: false, reason: 'viewing_room' };
    if (isMutedRoom(payload, store)) return { allow: false, reason: 'room_muted' };
    return { allow: true, reason: 'eligible' };
  }

  if (payload.event === 'message_update') {
    if (isViewingRoom(payload, store)) return { allow: false, reason: 'viewing_room' };
    return { allow: true, reason: 'eligible' };
  }

  return { allow: false, reason: 'not_target_event' };
}

export function decideLocalMessageNotification(
  payload: NotificationPayload,
  store: StoreState | null,
): NotificationDecision {
  if (payload.event !== 'new_message') return { allow: false, reason: 'not_target_event' };
  if (isAppActive(store)) return { allow: false, reason: 'app_active' };
  if (isViewingRoom(payload, store)) return { allow: false, reason: 'viewing_room' };
  if (isMutedRoom(payload, store)) return { allow: false, reason: 'room_muted' };
  // The server also queued an FCM/Expo push for this delivery. The OS renders
  // that banner when we're backgrounded/killed, so rendering our own here would
  // double-notify. Defer to the push. We still render locally as a FALLBACK
  // when no push floor was sent (recipient has no push token).
  if (payload.push_floor) return { allow: false, reason: 'push_floor' };
  return { allow: true, reason: 'eligible' };
}
