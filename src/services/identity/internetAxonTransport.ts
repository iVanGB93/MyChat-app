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
export const configuredWakeCustodian=(account:unknown)=>BOOTSTRAP_NEURONS.find(peer=>peer.account===account);

function bootstrapHost(input: string): string | null {
  // React Native's URL implementation only exposes hostname for HTTP(S).
  const host = /^wss:\/\/([a-z0-9.-]+)(?::443)?\/v2\/axon$/i.exec(input.trim())?.[1]?.toLowerCase();
  if (!host || host.length > 253) return null;
  const labels = host.split('.');
  if (!labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  if (/^(?:\d+|0x[0-9a-f]+)$/.test(labels[labels.length - 1]) &&
      (labels.length !== 4 || !labels.every(label => /^(?:0|[1-9]\d{0,2})$/.test(label) && Number(label) <= 255))) return null;
  return host;
}

export function parseBootstrapEndpoint(input: string): string | null {
  const host = bootstrapHost(input);
  return host ? `wss://${host}/v2/axon` : null;
}

export function createInternetAxonConnector(native: NativeAxonTransport & {
  axonWssConnect(host: string, account: string): Promise<string>;
}, localAccount: () => string | null, peers: () => readonly {account:string; endpoint:string}[] = () => BOOTSTRAP_NEURONS) {
  return async (candidate: NeuronCandidate, context: ConnectionContext) => {
    const own = localAccount();
    const seed = peers().find(peer => peer.endpoint === candidate.endpoint && peer.account === candidate.account);
    const host = seed && bootstrapHost(seed.endpoint);
    if (candidate.route !== 'internet' || !host || !own || !/^axonic:1:[0-9a-f]{64}$/.test(own)
      || context.signal.aborted) throw Error('Unsupported internet axon route');
    return openNativeWire(native, context, () => native.axonWssConnect(host, own));
  };
}
