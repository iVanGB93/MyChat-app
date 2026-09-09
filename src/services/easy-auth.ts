import { Platform, TurboModuleRegistry } from 'react-native';
import { APP_CONFIG } from '../config/appConfig';
import { saveTokens } from './authTokens';

export type SignInChallenge = { challenge_id: string; email: string; expires_in: number; google_link: boolean };
export type EasyAuthResult = SignInChallenge | { needs_username: true } | { access: string; refresh: string };
// Public OAuth audience, not a secret. Keep it in builds made locally or by EAS;
// an explicit environment override (including empty to disable) still wins.
const webClientId = (process.env.EXPO_PUBLIC_GOOGLE_SIGNIN_WEB_CLIENT_ID ??
  '515455178402-2p2uhhhdei7dfbgppfuphb6cg6qgadj2.apps.googleusercontent.com').trim();

export class EasyAuthError extends Error {}

export function googleSignInAvailable(): boolean {
  return Platform.OS === 'android' && !!webClientId && !!TurboModuleRegistry.get('RNGoogleSignin');
}

export async function easyAuthRequest(path: string, body: Record<string, string>): Promise<EasyAuthResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    // Public authentication: no existing credentials, refresh retries or logging.
    const response = await fetch(`${APP_CONFIG.SERVER_URL}/api/users/signin/${path}/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail :
        ['email', 'code', 'username'].flatMap((field) => Array.isArray(data?.[field]) ? data[field] : []).filter((value) => typeof value === 'string').join('\n');
      throw new EasyAuthError(detail || 'Sign-in is unavailable. Please try again later.');
    }
    return data;
  } finally { clearTimeout(timeout); }
}

export async function signInWithGoogle(): Promise<EasyAuthResult | null> {
  if (!googleSignInAvailable()) throw new Error('Google sign-in needs configuration and an updated Android build. Use email for now.');
  // Do not import the enforcing native module on older installed builds.
  const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
  GoogleSignin.configure({ webClientId });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const result = await GoogleSignin.signIn();
  if (result.type === 'cancelled') return null;
  if (!result.data.idToken) throw new Error('Google did not return a sign-in credential. Please try again.');
  return easyAuthRequest('google', { id_token: result.data.idToken });
}

export async function adoptEasyAuthResult(result: EasyAuthResult): Promise<boolean> {
  if (!('access' in result)) return false;
  if (typeof result.access !== 'string' || !result.access || typeof result.refresh !== 'string' || !result.refresh) {
    throw new Error('Invalid sign-in response. Please try again.');
  }
  await saveTokens(result.access, result.refresh);
  return true;
}
