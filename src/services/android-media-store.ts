import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type OwnedMediaStore = {
  supported: boolean;
  save(source: string, name: string, mime: string, kind: string): Promise<string>;
  available(uri: string): Promise<boolean>;
  requestDelete(uri: string, messageId: string): Promise<boolean>;
  deleteOwned(uri: string, messageId: string): Promise<'deleted' | 'missing' | 'needs-confirmation'>;
};
// Optional until the user rebuilds their development client. Never crash login
// or notifications simply because an older native build lacks this module.
export const androidMediaStore = Platform.OS === 'android'
  ? requireOptionalNativeModule<OwnedMediaStore>('AxonicMediaStore') : null;
export const hasAutomaticDeviceStorage = () => Boolean(androidMediaStore?.supported);
export const isMediaStoreUri = (uri: string) => uri.startsWith('content://media/');
