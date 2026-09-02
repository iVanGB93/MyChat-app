import { navigationRef } from '../navigation/AppNavigator';
import { useAppStore } from '../store/appStore';
import { isCallEnded } from './callDedupe';
import { parseNotificationDestination } from './notificationDestination';

const pendingKeys = new Set<string>();

/** Route a notification only after the authenticated navigator is mounted. */
export function navigateFromNotification(raw: Record<string, any> | null | undefined): void {
  const destination = parseNotificationDestination(raw);
  if (!destination) return;
  const key = destination.type === 'message'
    ? `message:${destination.roomId}`
    : `call:${destination.callId}`;
  if (pendingKeys.has(key)) return;
  pendingKeys.add(key);

  const attemptNavigation = (attempt = 0) => {
    if (attempt > 150) {
      pendingKeys.delete(key);
      return;
    }
    if (!navigationRef.isReady()) {
      setTimeout(() => attemptNavigation(attempt + 1), 200);
      return;
    }

    if (destination.type === 'message') {
      navigationRef.navigate('ChatRoom', {
        roomId: destination.roomId,
        roomName: destination.roomName,
        otherUserId: destination.otherUserId,
      });
      const route = navigationRef.getCurrentRoute();
      const params = route?.params as { roomId?: string } | undefined;
      if (route?.name !== 'ChatRoom' || params?.roomId !== destination.roomId) {
        setTimeout(() => attemptNavigation(attempt + 1), 200);
        return;
      }
    } else {
      if (isCallEnded(destination.callId)) {
        pendingKeys.delete(key);
        return;
      }
      const currentCall = useAppStore.getState().activeCall;
      if (currentCall?.callId !== destination.callId || currentCall.state === 'ended') {
        navigationRef.navigate('IncomingCall', {
          callId: destination.callId,
          callerName: destination.callerName,
          callerId: destination.callerId,
          callType: destination.callType,
          roomName: destination.roomName,
        });
      }
    }
    pendingKeys.delete(key);
  };

  attemptNavigation();
}
