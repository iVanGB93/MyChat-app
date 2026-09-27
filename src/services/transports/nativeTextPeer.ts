import { RTCPeerConnection } from 'react-native-webrtc';
import type { TextPeerConnection } from './p2pTextSession';

/** Direct-only prototype: deliberately omit TURN so relayed traffic is not
 * reported as direct P2P. Supply the app's configured STUN URLs when testing. */
export function createNativeTextPeer(stunUrls: string[]): TextPeerConnection {
  const urls = stunUrls.filter((url) => /^stuns?:/i.test(url));
  // The installed library implements EventTarget, but its inherited event
  // methods are missing from the published declarations in this build.
  return new RTCPeerConnection({ iceServers: urls.length ? [{ urls }] : [] }) as unknown as TextPeerConnection;
}
