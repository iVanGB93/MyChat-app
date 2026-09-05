import { navigationRef } from '../navigation/AppNavigator';
import { useAppStore } from '../store/appStore';
import { isCallEnded } from './callDedupe';
import { parseNotificationDestination } from './notificationDestination';

const pendingKeys = new Set<string>();
const RETRY_DELAY_MS = 200;
const MAX_NAVIGATION_ATTEMPTS = 150;

function routeIsRegistered(routeName: 'ChatRoom' | 'IncomingCall'): boolean {
  try {
    return navigationRef.getRootState()?.routeNames?.includes(routeName) === true;
  } catch {
    return false;
  }
}

/** Route a notification only after the authenticated navigator is mounted. */
export function navigateFromNotification(raw: Record<string, any> | null | undefined): void {
  const destination = parseNotificationDestination(raw);
  if (!destination) return;
  const key = destination.type === 'message'
    ? `message:${destination.roomId}`
    : `call:${destination.callId}`;
  if (pendingKeys.has(key)) return;
  pendingKeys.add(key);

  let lastNavigationAt = 0;
  const attemptNavigation = (attempt = 0) => {
    if (attempt > MAX_NAVIGATION_ATTEMPTS) {
      pendingKeys.delete(key);
      return;
    }
    const requiredRoute = destination.type === 'message' ? 'ChatRoom' : 'IncomingCall';
    const auth = useAppStore.getState();
    if (
      !navigationRef.isReady()
      || auth.authLoading
      || !auth.user
      || !routeIsRegistered(requiredRoute)
    ) {
      setTimeout(() => attemptNavigation(attempt + 1), RETRY_DELAY_MS);
      return;
    }

    try {
      const route = navigationRef.getCurrentRoute();
      if (destination.type === 'message') {
        const params = route?.params as { roomId?: string } | undefined;
        if (route?.name === 'ChatRoom' && params?.roomId === destination.roomId) {
          pendingKeys.delete(key);
          return;
        }

        // Do not repeatedly enqueue the same screen while React Navigation is
        // still applying its previous state update on a slow cold start.
        const now = Date.now();
        if (now - lastNavigationAt >= 1_000 || lastNavigationAt === 0) {
          lastNavigationAt = now;
          navigationRef.navigate('ChatRoom', {
            roomId: destination.roomId,
            roomName: destination.roomName || 'Chat',
            otherUserId: destination.otherUserId,
          });
        }
        setTimeout(() => attemptNavigation(attempt + 1), RETRY_DELAY_MS);
        return;
      }

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
      pendingKeys.delete(key);
    } catch (error) {
      // The container can detach between isReady/getRootState/navigate while
      // authentication swaps the root stack. A notification tap must never
      // become an uncaught release-build exception; retry after it settles.
      setTimeout(() => attemptNavigation(attempt + 1), RETRY_DELAY_MS);
      return;
    }
  };

  attemptNavigation();
}
