import AsyncStorage from '@react-native-async-storage/async-storage';

const INSTALLATION_ID_KEY = '@axonic_installation_id';

function generateInstallationId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const random = (Math.random() * 16) | 0;
      return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
    });
  }
}

/** Stable device-install identity shared by authentication, media confirmation,
 * and push registration without coupling those service layers together. */
export async function getInstallationId(): Promise<string> {
  const existing = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
  if (existing) return existing;
  const created = generateInstallationId();
  await AsyncStorage.setItem(INSTALLATION_ID_KEY, created);
  return created;
}
