import { openNativeWire, type NativeAxonTransport } from './nativeAxonTransport';
import type { NeuronCandidate, ConnectionContext } from './neuronConnections';

/** A bootstrap address is only a locator. Shared identity verification pins the actual peer.
 * Native code independently restricts the destination and verifies TLS before framing.
 */
export const FIRST_NEURON = Object.freeze({
  account: 'axonic:1:778f81f35399db5b3bfa5068e34aad2a4389f851b64aebc997cd453879cd008f',
  endpoint: 'wss://143.198.121.2/v2/axon',
});
export function createInternetAxonConnector(native: NativeAxonTransport & {
  axonWssConnect(host: string, account: string): Promise<string>;
}, localAccount: () => string | null) {
  return async (candidate: NeuronCandidate, context: ConnectionContext) => {
    const own = localAccount();
    if (candidate.route !== 'internet' || candidate.endpoint !== FIRST_NEURON.endpoint
      || candidate.account !== FIRST_NEURON.account || !own || !/^axonic:1:[0-9a-f]{64}$/.test(own)
      || context.signal.aborted) throw Error('Unsupported internet axon route');
    return openNativeWire(native, context, () => native.axonWssConnect('143.198.121.2', own));
  };
}
