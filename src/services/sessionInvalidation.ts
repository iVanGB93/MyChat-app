/* ------------------------------------------------------------------ */
/*  Session invalidation bridge                                        */
/*                                                                     */
/*  Transport modules cannot import AuthContext without creating an    */
/*  initialization cycle. This tiny event bridge lets them report an   */
/*  explicitly rejected refresh/access token, and lets AuthContext     */
/*  perform one normal logout.                                         */
/* ------------------------------------------------------------------ */

type Listener = (reason: string) => void;

const listeners = new Set<Listener>();

export function subscribeSessionInvalidation(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function invalidateSession(reason: string): void {
  for (const listener of listeners) {
    try { listener(reason); } catch { /* one listener must not block the rest */ }
  }
}
