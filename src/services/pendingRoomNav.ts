/* ------------------------------------------------------------------ */
/*  Pending room navigation                                            */
/*                                                                      */
/*  When a message notification is pressed while the app is in the      */
/*  BACKGROUND, Notifee delivers the press to the background event      */
/*  handler (not the foreground one). Navigation can't run there, so we */
/*  stash the target here and the app consumes it when it becomes       */
/*  active. Foreground presses navigate directly; cold-start uses       */
/*  getInitialNotification.                                             */
/* ------------------------------------------------------------------ */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PendingRoomNav {
  roomId: string;
  roomName: string;
  senderId?: string;
}

let _pending: PendingRoomNav | null = null;
const PENDING_ROOM_NAV_KEY = '@axonic_pending_room_navigation';

export function setPendingRoomNav(nav: PendingRoomNav): void {
  _pending = nav;
  AsyncStorage.setItem(PENDING_ROOM_NAV_KEY, JSON.stringify(nav)).catch(() => {});
}

export async function takePendingRoomNav(): Promise<PendingRoomNav | null> {
  let value = _pending;
  _pending = null;
  if (!value) {
    try {
      const raw = await AsyncStorage.getItem(PENDING_ROOM_NAV_KEY);
      value = raw ? JSON.parse(raw) as PendingRoomNav : null;
    } catch {
      value = null;
    }
  }
  await AsyncStorage.removeItem(PENDING_ROOM_NAV_KEY).catch(() => {});
  return value;
}
