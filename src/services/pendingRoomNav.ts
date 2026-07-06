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

export interface PendingRoomNav {
  roomId: string;
  roomName: string;
  senderId?: string;
}

let _pending: PendingRoomNav | null = null;

export function setPendingRoomNav(nav: PendingRoomNav): void {
  _pending = nav;
}

export function takePendingRoomNav(): PendingRoomNav | null {
  const v = _pending;
  _pending = null;
  return v;
}
