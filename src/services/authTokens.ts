import AsyncStorage from '@react-native-async-storage/async-storage';

export interface TokenPair {
  access: string;
  refresh: string;
}

const SECURE_TOKEN_KEY = 'axonic.auth.tokens.v1';
const LEGACY_TOKEN_KEY = '@axonic_tokens';

let memoryTokens: TokenPair | null | undefined;
let loadPromise: Promise<TokenPair | null> | null = null;
let secureStoreAvailable: boolean | null = null;

function parseTokens(raw: string | null): TokenPair | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (typeof value?.access === 'string' && typeof value?.refresh === 'string') {
      return { access: value.access, refresh: value.refresh };
    }
  } catch {
    // Corrupt credentials must be treated as logged out.
  }
  return null;
}

async function getSecureStore() {
  if (secureStoreAvailable === false) return null;
  try {
    // Dynamic loading keeps existing development clients usable until their
    // next native rebuild includes expo-secure-store.
    const secureStore = await import('expo-secure-store');
    if (secureStoreAvailable === null) {
      secureStoreAvailable = await secureStore.isAvailableAsync();
    }
    return secureStoreAvailable ? secureStore : null;
  } catch {
    secureStoreAvailable = false;
    return null;
  }
}

async function loadTokens(): Promise<TokenPair | null> {
  const secureStore = await getSecureStore();
  if (secureStore) {
    const secureTokens = parseTokens(await secureStore.getItemAsync(SECURE_TOKEN_KEY));
    if (secureTokens) {
      // Finish cleanup if a previous migration was interrupted.
      await AsyncStorage.removeItem(LEGACY_TOKEN_KEY).catch(() => {});
      return secureTokens;
    }
  }

  const legacyRaw = await AsyncStorage.getItem(LEGACY_TOKEN_KEY);
  const legacyTokens = parseTokens(legacyRaw);
  if (!legacyTokens) return null;

  if (secureStore) {
    await secureStore.setItemAsync(SECURE_TOKEN_KEY, JSON.stringify(legacyTokens));
    await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
  }
  return legacyTokens;
}

export async function getTokens(): Promise<TokenPair | null> {
  if (memoryTokens !== undefined) return memoryTokens;
  if (!loadPromise) {
    loadPromise = loadTokens()
      .then((tokens) => {
        memoryTokens = tokens;
        return tokens;
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

export async function saveTokens(access: string, refresh: string): Promise<void> {
  const tokens = { access, refresh };
  const serialized = JSON.stringify(tokens);
  const secureStore = await getSecureStore();

  if (secureStore) {
    await secureStore.setItemAsync(SECURE_TOKEN_KEY, serialized);
    await AsyncStorage.removeItem(LEGACY_TOKEN_KEY).catch(() => {});
  } else {
    // Temporary compatibility path for an already-installed development
    // client that predates the native SecureStore module.
    await AsyncStorage.setItem(LEGACY_TOKEN_KEY, serialized);
  }
  memoryTokens = tokens;
}

export async function clearTokens(): Promise<void> {
  memoryTokens = null;
  const secureStore = await getSecureStore();
  await Promise.all([
    AsyncStorage.removeItem(LEGACY_TOKEN_KEY),
    secureStore?.deleteItemAsync(SECURE_TOKEN_KEY) ?? Promise.resolve(),
  ]);
}

