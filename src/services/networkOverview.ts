/** Describe only this installation's observed session, never a global network size. */
export function networkOverview(input: {
  user: number | null; enabled: boolean; lifecycle: string; online: boolean;
  session: { owner: number | null; restoring: boolean; error: string | null;
    discovered: number[]; signaling: unknown; directStored: number };
}) {
  const own = input.user !== null && input.session.owner === input.user;
  const ready = own && !!(input.session.signaling as { ready?: boolean } | null)?.ready;
  const state = !input.enabled ? 'Unavailable' : !input.user ? 'Sign in required'
    : input.lifecycle !== 'active' ? 'Paused' : !input.online ? 'No internet connection'
    : input.session.restoring ? 'Restoring connection'
    : ready ? 'Hosted peer reachable' : own ? 'Waiting for peer' : 'Not connected';
  return {
    state,
    hostedReachable: input.enabled && input.lifecycle === 'active' && input.online && ready,
    // Introductions prove neither current reachability nor an open data channel.
    introducedPeers: own ? new Set(input.session.discovered.filter(id => id !== input.user)).size : 0,
    directDelivered: own ? input.session.directStored : 0,
    error: input.user && input.session.error ? input.session.error : null,
  };
}
