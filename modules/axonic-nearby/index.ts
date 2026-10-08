import { requireOptionalNativeModule } from 'expo';
export interface NearbyEvent { type: 'peers' | 'signal' | 'stopped' | 'error'; count?: number; frame?: string; reason?: string }
interface NearbyModule {
  axonMessageWake?(milliseconds:number):void;
  axonMessageWait?(milliseconds:number):Promise<void>;
  axonConnectedCall?(enabled: boolean): void;
  axonLanStart?(account: string): Promise<void>;
  axonLanStop?(): void;
  axonLanSnapshot?(): { active: boolean; peers: { account: string; host: string; port: number }[] };
  axonAccept?(): Promise<{ id: string; account: string; host: string; hello: string } | null>;
  axonClaim?(id: string): void;
  axonEnableAttachments?(id:string):void;
  axonConnect?(host: string, port: number): Promise<string>;
  axonWssConnect?(host: string, account: string): Promise<string>;
  axonRead?(id: string): Promise<string>;
  axonWrite?(id: string, raw: string): Promise<boolean>;
  axonClose?(id: string): void;
  identityRandomBytes?(size: number): Promise<string>;
  identityScrypt?(password: string, salt: string): Promise<string>;
  mailboxIdentity?(owner: number): Promise<{ encryption: string; signing: string }>;
  mailboxDigest?(value: string): Promise<string>;
  mailboxSign?(owner: number, value: string): Promise<string>;
  mailboxVerify?(key: string, value: string, signature: string): Promise<boolean>;
  mailboxSeal?(key: string, header: string, plaintext: string): Promise<{ wrappedKey: string; iv: string; ciphertext: string }>;
  mailboxOpen?(owner: number, header: string, key: string, iv: string, ciphertext: string): Promise<string>;
  start(roomId: string, userId: number, peerId: number): Promise<void>;
  stop(): Promise<void>;
  send(frame: string): boolean;
  addListener(name: 'onNearby', listener: (event: NearbyEvent) => void): { remove(): void };
}
export default requireOptionalNativeModule<NearbyModule>('AxonicNearby');
