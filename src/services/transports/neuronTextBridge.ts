import type { OutgoingTextMessage, TextDeliveryOptions } from './textTransport';
type Attempt = (message: OutgoingTextMessage, options?: TextDeliveryOptions) => Promise<{ peerId: number; delivered: boolean } | null>;
let active: { attempt: Attempt } | null = null;
export const isNeuronTextReady = () => active !== null;
/** Registered only by the normal account runtime, never by the experimental message queue. */
export function registerNeuronTextAttempt(attempt: Attempt) {
  const registration = { attempt }; active = registration;
  return () => { if (active === registration) active = null; };
}
export async function tryNeuronText(message: OutgoingTextMessage, options?: TextDeliveryOptions) {
  const session = active;
  if (!session) return null;
  try { const result = await session.attempt(message, options); return active === session ? result : null; }
  catch { return null; }
}
