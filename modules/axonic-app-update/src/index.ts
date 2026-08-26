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
}

interface AxonicAppUpdateNativeModule {
  getUpdateInfoAsync(): Promise<PlayUpdateInfo>;
}

const nativeModule = requireOptionalNativeModule<AxonicAppUpdateNativeModule>('AxonicAppUpdate');

/** Returns null on iOS, web, and older native builds that do not include the module. */
export async function getPlayUpdateInfoAsync(): Promise<PlayUpdateInfo | null> {
  if (!nativeModule) return null;
  return nativeModule.getUpdateInfoAsync();
}
