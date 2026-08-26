import { AppState } from 'react-native';
import type { AppState as StoreState } from '../store/appStore';
import type { NotificationPayload } from './axionTypes';
import {
  decideInAppMessageToast as decideInAppMessageToastCore,
  decideIncomingCallInApp as decideIncomingCallInAppCore,
  decideLocalIncomingCallNotification as decideLocalIncomingCallNotificationCore,
  decideLocalMessageNotification as decideLocalMessageNotificationCore,
  type NotificationDecision,
  type NotificationDecisionContext,
} from './notificationDecision';
export type { NotificationDecision, NotificationDecisionReason } from './notificationDecision';

function decisionContext(store: StoreState | null): NotificationDecisionContext {
  return {
    appActive: store ? store.appLifecycle === 'active' : AppState.currentState === 'active',
    activeRoomId: store?.activeRoomId ?? null,
    mutedRooms: store?.mutedRooms ?? {},
    activeCall: store?.activeCall
      ? { callId: store.activeCall.callId, state: store.activeCall.state }
      : null,
  };
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
  return decideIncomingCallInAppCore(payload, decisionContext(store));
}

export function decideLocalIncomingCallNotification(
  payload: NotificationPayload,
  store: StoreState | null,
): NotificationDecision {
  return decideLocalIncomingCallNotificationCore(payload, decisionContext(store));
}

export function decideInAppMessageToast(
  payload: NotificationPayload,
  store: StoreState | null,
): NotificationDecision {
  return decideInAppMessageToastCore(payload, decisionContext(store));
}

export function decideLocalMessageNotification(
  payload: NotificationPayload,
  store: StoreState | null,
): NotificationDecision {
  return decideLocalMessageNotificationCore(payload, decisionContext(store));
}
