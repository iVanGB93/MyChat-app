import Native from '../../../modules/axonic-nearby';
import { createNativeAxonConnector } from './nativeAxonTransport';

export const mobileAxonTransportSupported = () => !!Native?.axonConnect && !!Native?.axonRead && !!Native?.axonWrite && !!Native?.axonClose;
/** Caller supplies locally discovered candidates. Never falls back to an unbounded JS socket. */
export function mobileAxonConnector() {
  if (!mobileAxonTransportSupported()) throw Error('An updated development client is required for axon transport');
  return createNativeAxonConnector({
    axonConnect: (host, port) => Native!.axonConnect!(host, port),
    axonRead: id => Native!.axonRead!(id),
    axonWrite: (id, raw) => Native!.axonWrite!(id, raw),
    axonClose: id => Native!.axonClose!(id),
  });
}
