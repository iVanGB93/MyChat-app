import { requireOptionalNativeModule } from 'expo';
interface NearbyModule {
  notificationReadActionInShade?(id:string):Promise<boolean>;
  attachmentSha256?(value:string):string;
  attachmentFileSha256?(owner:string,digest:string,completed:boolean,bytes:number):Promise<string>;
  attachmentStagedFileSha256?(owner:string,id:string,bytes:number):Promise<string>;
  axonMessageWake?(milliseconds:number):void;
  axonMessageWait?(milliseconds:number):Promise<void>;
  axonConnectedCall?(enabled: boolean): void;
  axonLanStart?(account: string): Promise<void>;
  axonLanStop?(): void;
  axonLanSnapshot?(): { active: boolean; peers: { account: string; host: string; port: number }[] };
  axonAccept?(): Promise<{ id: string; account: string; host: string; hello: string } | null>;
  axonClaim?(id: string): void;
  axonEnableAttachments?(id:string):void;
  axonEnableMediaLane?(id:string):void;
  axonEnableBulkAttachments?(id:string):void;
  axonConnect?(host: string, port: number): Promise<string>;
  axonWssConnect?(host: string, account: string): Promise<string>;
  axonRead?(id: string): Promise<string>;
  axonWrite?(id: string, raw: string): Promise<boolean>;
  axonClose?(id: string): void;
  closeForDeviceRemoval?(): boolean;
  identityRandomBytes?(size: number): Promise<string>;
  identityScrypt?(password: string, salt: string): Promise<string>;
}
export default requireOptionalNativeModule<NearbyModule>('AxonicNearby');
