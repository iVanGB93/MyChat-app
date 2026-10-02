import type { OutgoingTextMessage, TextDeliveryOptions, TextTransport } from './textTransport';

/**
 * Selection stays independent of UI, storage and socket ownership. A direct
 * attempt returns a peer only after its storage receipt; Axion returns handoff.
 */
export function createTextTransportManager(
  legacyTransport: TextTransport,
  tryDirect?: (message: OutgoingTextMessage, options?: TextDeliveryOptions) => Promise<number | null>,
  tryMailbox?: (message: OutgoingTextMessage, options?: TextDeliveryOptions) => Promise<{ peerId: number; delivered: boolean } | null>,
  tryNeuron?: (message: OutgoingTextMessage, options?: TextDeliveryOptions) => Promise<{ peerId: number; delivered: boolean } | null>,
) {
  return {
    async send(message: OutgoingTextMessage, options?: TextDeliveryOptions, canSend = () => true) {
      if (!canSend()) return { sent: false, transport: 'axion' as const };
      let peerId: number | null = null;
      try { peerId = await tryDirect?.(message, options) ?? null; } catch { /* fallback */ }
      if (!canSend()) return { sent: false, transport: 'axion' as const };
      if (peerId != null) return { sent: true, transport: 'p2p' as const, peerId };
      let neuron = null;
      try { neuron = await tryNeuron?.(message, options) ?? null; } catch { /* fallback */ }
      if (!canSend()) return { sent: false, transport: 'axion' as const };
      if (neuron) {
        // Custody cannot wake a background phone yet. Preserve the same UUID on
        // the migration fallback so push delivery and later custody deduplicate.
        if (!neuron.delivered) {
          try { if (legacyTransport.send(message, options)) return { sent: true, transport: 'axion' as const }; }
          catch { /* The encrypted custody copy remains queued when Axion is unavailable. */ }
        }
        return { sent: true, transport: 'neuron' as const, ...neuron };
      }
      let mailbox = null;
      try { mailbox = await tryMailbox?.(message, options) ?? null; } catch { /* fallback */ }
      if (!canSend()) return { sent: false, transport: 'axion' as const };
      if (mailbox) return { sent: true, transport: 'mailbox' as const, ...mailbox };
      return { sent: legacyTransport.send(message, options), transport: 'axion' as const };
    },
  };
}
