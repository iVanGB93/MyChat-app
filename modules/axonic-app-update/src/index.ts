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
  getUpdateInfoAsync(): Promise<PlayUpdateInfo>;
  startUpdateAsync?: (immediate: boolean) => Promise<PlayUpdateStartResult>;
  completeUpdateAsync?: () => Promise<void>;
}

const nativeModule = requireOptionalNativeModule<AxonicAppUpdateNativeModule>('AxonicAppUpdate');
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
