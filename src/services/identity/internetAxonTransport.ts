import { openNativeWire, type NativeAxonTransport } from './nativeAxonTransport';
import type { NeuronCandidate, ConnectionContext } from './neuronConnections';

/** A bootstrap address is only a locator. Shared identity verification pins the actual peer.
 * Native code independently restricts the destination and verifies TLS before framing.
 */
export const FIRST_NEURON = Object.freeze({
  account: 'axonic:1:778f81f35399db5b3bfa5068e34aad2a4389f851b64aebc997cd453879cd008f',
  endpoint: 'wss://143.198.121.2/v2/axon',
});
export const SECOND_NEURON = Object.freeze({
  account: 'axonic:1:77fe994da47f6239debbe70b516eede89d8645796e6803e41b1701b5df0df0fa',
  endpoint: 'wss://secondneuron-production.up.railway.app/v2/axon',
});
export const BOOTSTRAP_NEURONS = Object.freeze([FIRST_NEURON, SECOND_NEURON]);
export function createInternetAxonConnector(native: NativeAxonTransport & {
  axonWssConnect(host: string, account: string): Promise<string>;
}, localAccount: () => string | null) {
  return async (candidate: NeuronCandidate, context: ConnectionContext) => {
    const own = localAccount();
    const seed = BOOTSTRAP_NEURONS.find(peer => peer.endpoint === candidate.endpoint && peer.account === candidate.account);
    if (candidate.route !== 'internet' || !seed || !own || !/^axonic:1:[0-9a-f]{64}$/.test(own)
      || context.signal.aborted) throw Error('Unsupported internet axon route');
    return openNativeWire(native, context, () => native.axonWssConnect(new URL(seed.endpoint).hostname, own));
  };
}
