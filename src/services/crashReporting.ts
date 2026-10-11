import * as Sentry from '@sentry/react-native';
import { sanitizeCrashEvent } from './crashReportingPrivacy';

let initialized = false;

/** An empty DSN disables reporting. Debug builds require explicit opt-in. */
export function configureCrashReporting(): void {
  if (initialized) return;
  initialized = true;
  // A DSN is a public ingest address, not an account or build-upload credential.
  const dsn = (process.env.EXPO_PUBLIC_SENTRY_DSN ?? 'https://7248a02e8a2a494e5c283689af18604c@o4507382623109120.ingest.us.sentry.io/4512077800538112').trim();
  if (!dsn || (__DEV__ && process.env.EXPO_PUBLIC_SENTRY_DEBUG !== 'true')) return;
  try {
    Sentry.init({
      dsn,
      environment: __DEV__ ? 'development' : 'production',
      sendDefaultPii: false,
      enableNative: true,
      enableNativeCrashHandling: true,
      enableNativeNagger: false,
      enableAutoSessionTracking: false,
      enableAutoPerformanceTracing: false,
      enableAppStartTracking: false,
      enableNativeFramesTracking: false,
      enableStallTracking: false,
      enableUserInteractionTracing: false,
      enableCaptureFailedRequests: false,
      enableLogs: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      maxBreadcrumbs: 0,
      maxCacheItems: 20,
      beforeBreadcrumb: () => null,
      beforeSend: sanitizeCrashEvent,
      integrations: (defaults) => defaults.filter((integration) =>
        !['Breadcrumbs', 'HttpContext', 'ExpoConstants', 'ExpoContext', 'MobileReplay', 'BrowserReplay'].includes(integration.name)),
    });
  } catch {
    // Observability must never prevent the app or background handlers from starting.
    if (__DEV__) console.warn('[CrashReporting] initialization failed');
  }
}
