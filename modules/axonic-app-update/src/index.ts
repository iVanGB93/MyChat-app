import { requireOptionalNativeModule } from 'expo';

export type PlayUpdateAvailability =
  | 'unknown'
  | 'not_available'
  | 'available'
  | 'in_progress';

export interface PlayUpdateInfo {
  availability: PlayUpdateAvailability;
  availableVersionCode: number | null;
  updatePriority: number;
  stalenessDays: number | null;
  flexibleAllowed: boolean;
  immediateAllowed: boolean;
  installStatus?: number;
  bytesDownloaded?: number;
  totalBytesToDownload?: number;
}

interface AxonicAppUpdateNativeModule {
  chatStorageRecoveryAvailable?: boolean;
  checkChatStorageWrite?: (owner:string,bytes:number)=>Promise<void>;
  readChatStorage?: (owner:string)=>Promise<string|null>;
  clearChatRecoverySnapshot?: ()=>Promise<void>;
  getDiagnosticBuildInfo?:()=>Promise<{applicationId:string;versionName:string|null;versionCode:string}>;
  getKeyboardOverlap?: (viewTag:number)=>Promise<{visible:boolean;overlap:number}|null>;
  addListener?: (event: string, listener: (state: { installStatus: number }) => void) => { remove(): void };
  getUpdateInfoAsync(): Promise<PlayUpdateInfo>;
  startUpdateAsync?: (immediate: boolean) => Promise<PlayUpdateStartResult>;
  completeUpdateAsync?: () => Promise<void>;
}

const nativeModule = requireOptionalNativeModule<AxonicAppUpdateNativeModule>('AxonicAppUpdate');
export const supportsChatStorageRecovery=()=>nativeModule?.chatStorageRecoveryAvailable!==false&&typeof nativeModule?.readChatStorage==='function';
export const checkNativeChatWrite=async(owner:string,bytes:number)=>{if(supportsChatStorageRecovery())await nativeModule?.checkChatStorageWrite?.(owner,bytes);};
export const clearChatRecoverySnapshot=async()=>{await nativeModule?.clearChatRecoverySnapshot?.();};
export const readNativeChatStorage=(owner:string)=>{if(!nativeModule?.readChatStorage)throw Error('Chat recovery requires an updated native build');return nativeModule.readChatStorage(owner);};
export async function getDiagnosticBuildInfo(){try{return await nativeModule?.getDiagnosticBuildInfo?.()??null;}catch{return null;}}
export const supportsKeyboardOverlap=()=>typeof nativeModule?.getKeyboardOverlap==='function';
export async function getKeyboardOverlap(viewTag:number){
  try{return await nativeModule?.getKeyboardOverlap?.(viewTag)??null;}catch{return null;}
}
export function observePlayInstallStatus(listener: (status: number) => void): { remove(): void } | undefined {
  try {
    return nativeModule?.addListener?.('onInstallState', (event) => listener(event.installStatus));
  } catch { return undefined; } // Older clients rely on status polling.
}
export type PlayUpdateStartResult = 'accepted' | 'cancelled' | 'failed' | 'unavailable' | 'busy' | 'downloaded';
export function supportsPlayUpdateFlow(): boolean {
  return typeof nativeModule?.startUpdateAsync === 'function' && typeof nativeModule?.completeUpdateAsync === 'function';
}
export async function startPlayUpdateAsync(immediate = false): Promise<PlayUpdateStartResult> {
  return nativeModule?.startUpdateAsync ? nativeModule.startUpdateAsync(immediate) : 'unavailable';
}
export async function completePlayUpdateAsync(): Promise<void> {
  if (!nativeModule?.completeUpdateAsync) throw new Error('This build cannot install in-app updates.');
  await nativeModule.completeUpdateAsync();
}

/** Returns null on iOS, web, and older native builds that do not include the module. */
export async function getPlayUpdateInfoAsync(): Promise<PlayUpdateInfo | null> {
  if (!nativeModule) return null;
  return nativeModule.getUpdateInfoAsync();
}
