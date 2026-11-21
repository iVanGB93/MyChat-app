import type {CustodyEnvelope, CustodyReceipt} from '../../services/identity/custodyProtocol';
import {receiptDeliveryEvidence} from '../../services/identity/deliveryEvidence';
import {localRootChat} from '../../services/identity/localRootChat';
import {mobileTrialCredits} from '../../services/identity/mobileTrialCredits';
import {trialReference} from '../../services/identity/trialCredits';

/** Converts verified network events to durable phone chat state. */
function observeRelayUse(envelope: CustodyEnvelope, chat: 'private' | 'group') {
  void mobileTrialCredits(envelope.sender).observe({
    kind: 'relay-use', chat, reference: trialReference(envelope.sender,envelope.id,envelope.recipient),
  });
}

export async function recordMessageCustody(envelope: CustodyEnvelope, relay: string, chat: 'private' | 'group') {
  await localRootChat().networkStored(envelope.recipient,envelope.id,envelope.expires,false,relay);
  observeRelayUse(envelope,chat);
}

export async function recordGroupCustody(envelopes: CustodyEnvelope[], relay: string) {
  await localRootChat().networkStoredGroup(envelopes,relay);
  for (const envelope of envelopes) observeRelayUse(envelope,'group');
}

export async function confirmMessageReceipt(receipt: CustodyReceipt, current: () => boolean, relay: string, group = false) {
  if (!current()) return false;
  const ledger = localRootChat();
  const known = await ledger.hasOutgoingReceipt(receipt.recipient,receipt.id,group);
  if (!current() || !known) return false;
  await ledger.delivered(receipt.recipient,receipt.id,receiptDeliveryEvidence(receipt,receipt.sender,Date.now(),relay));
  return current();
}
