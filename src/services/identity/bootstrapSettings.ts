import AsyncStorage from '@react-native-async-storage/async-storage';
import { FIRST_NEURON, SECOND_NEURON, parseBootstrapEndpoint } from './internetAxonTransport';
import { createMobileRecoveryDiscovery } from './mobileRecoveryDiscovery';

const key = '@axonic_bootstrap_endpoint_v1';
export const defaultBootstrapEndpoint = FIRST_NEURON.endpoint;
let endpoint: string = defaultBootstrapEndpoint;
let loading: Promise<void> | undefined;

export { parseBootstrapEndpoint };

export const bootstrapEndpoint = () => endpoint;
export const bootstrapPeers = () => [{ ...FIRST_NEURON, endpoint, preferredBootstrap: true }, SECOND_NEURON];
export function loadBootstrapEndpoint() {
  return loading ??= AsyncStorage.getItem(key).then(value => {
    endpoint = (value && parseBootstrapEndpoint(value)) || defaultBootstrapEndpoint;
  }).catch(error => { loading = undefined; throw error; });
}

export async function saveBootstrapEndpoint(input: string) {
  const next = parseBootstrapEndpoint(input);
  if (!next) throw Error('Invalid bootstrap endpoint');
  await loadBootstrapEndpoint();
  await AsyncStorage.setItem(key, next);
  endpoint = next;
}

export async function testBootstrapEndpoint(input: string) {
  const endpoint = parseBootstrapEndpoint(input);
  if (!endpoint) throw Error('Invalid bootstrap endpoint');
  const session = createMobileRecoveryDiscovery({ ...FIRST_NEURON, endpoint });
  try { await session.verifyConnection(); }
  finally { session.stop(); }
}
