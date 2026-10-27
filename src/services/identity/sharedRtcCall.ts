/** A call borrows the authenticated network connection; it never owns close(). */
export interface SharedRtcCallLease {
  connection: unknown;
  channelLabel: string;
  current(): boolean;
  validateRemote(sdp:string): boolean;
  release(): void;
}
