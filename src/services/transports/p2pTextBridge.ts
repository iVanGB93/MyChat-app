import type { OutgoingTextMessage, TextDeliveryOptions } from './textTransport';

// Explicit opt-in, ignored in production builds. This is not an E2EE rollout.
export const P2P_TEXT_ENABLED = __DEV__ && process.env.EXPO_PUBLIC_AXONIC_P2P_TEXT === '1';
// Release opt-in applies only to the pinned, encrypted mailbox/network path.
export const MAILBOX_ENABLED = P2P_TEXT_ENABLED || process.env.EXPO_PUBLIC_AXONIC_NETWORK === '1';
let attempt: ((message: OutgoingTextMessage, options?: TextDeliveryOptions) => Promise<number | null>) | null = null;

export function configureP2pTextAttempt(handler: NonNullable<typeof attempt>): void { attempt = handler; }
export async function tryP2pText(message: OutgoingTextMessage, options?: TextDeliveryOptions): Promise<number | null> {
  if (!P2P_TEXT_ENABLED || !attempt) return null;
  try { return await attempt(message, options); } catch { return null; }
}

export interface MailboxTextResult { peerId: number; delivered: boolean }
type MailboxAttempt = (message: OutgoingTextMessage, options?: TextDeliveryOptions) => Promise<MailboxTextResult | null>;
let mailboxAttempt: MailboxAttempt | null = null;
export function configureMailboxTextAttempt(handler: MailboxAttempt | null) { mailboxAttempt = handler; }
export async function tryMailboxText(message: OutgoingTextMessage, options?: TextDeliveryOptions) {
  if (!MAILBOX_ENABLED || !mailboxAttempt) return null;
  try { return await mailboxAttempt(message, options); } catch { return null; }
}
type MailboxDelivered = (owner: number, message: OutgoingTextMessage, peer: number, current: () => boolean) => Promise<boolean>;
let mailboxDelivered: MailboxDelivered | null = null;
export function configureMailboxDelivered(handler: MailboxDelivered) { mailboxDelivered = handler; }
export function acceptMailboxDelivered(owner: number, message: OutgoingTextMessage, peer: number, current: () => boolean) {
  return mailboxDelivered?.(owner, message, peer, current) ?? Promise.resolve(false);
}
