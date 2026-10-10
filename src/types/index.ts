/** Shared presentation types for neuron calls. Identity and messaging models live in their modules. */
export type CallType = 'voice' | 'video';

/** ICE configuration supplied by the authenticated neuron call transport. */
export interface IceConfig {
  ice_servers: RTCIceServer[];
  ice_transport_policy: 'all' | 'relay';
}
