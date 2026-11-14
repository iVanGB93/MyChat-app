import { hexToBytes } from '@noble/hashes/utils.js';
import type { NativeAxonTransport } from './nativeAxonTransport';
import Native from '../../../modules/axonic-nearby';
import { createRecoveryLookupSession } from './recoveryLookupSession';
import { createInternetAxonConnector, FIRST_NEURON, type BOOTSTRAP_NEURONS } from './internetAxonTransport';
import { createMobileIdentityRecordStore } from './identityRecordStore';
export function createMobileRecoveryDiscovery(peer:(typeof BOOTSTRAP_NEURONS)[number]=FIRST_NEURON) {
  if (!Native?.axonWssConnect || !Native?.identityRandomBytes) throw Error('Recovery transport unavailable in this build');
  const native = Native as NativeAxonTransport & { axonWssConnect(host: string, account: string): Promise<string>; identityRandomBytes(size: number): Promise<string> };
  return createRecoveryLookupSession({ now: Date.now, peer: peer.account,
    store: createMobileIdentityRecordStore(Date.now),
    random: async size => hexToBytes(await native.identityRandomBytes(size)),
    connect: (account, signal) => createInternetAxonConnector(native, () => account)(
      { ...peer, route: 'internet', expiresAt: Date.now() + 60000 }, { signal, onClosed() {} }),
  });
}
