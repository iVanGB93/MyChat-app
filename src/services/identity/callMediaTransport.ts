/** Portable, call-scoped signaling adapter. Private signing keys stay on the neuron. */
export interface CallMediaTransport {
 send(kind:string,data:Record<string,unknown>):Promise<boolean>;
 subscribe(listener:(kind:string,data:Record<string,unknown>)=>void):()=>void;
 loadIceConfig():Promise<{ice_servers:{urls:string|string[];username?:string;credential?:string}[];ice_transport_policy:'all'|'relay'}>;
}
