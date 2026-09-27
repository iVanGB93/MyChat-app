import { requireOptionalNativeModule } from 'expo';
export interface NearbyEvent { type: 'peers' | 'signal' | 'stopped' | 'error'; count?: number; frame?: string; reason?: string }
interface NearbyModule {
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
