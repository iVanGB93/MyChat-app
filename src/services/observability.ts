import Observe, { AppMetrics } from 'expo-observe';

/**
 * Configure EAS Observe before React mounts.
 *
 * Debug dispatch is intentionally enabled while the integration is being
 * validated on the two development emulators. The explicit environment keeps
 * those slower debug measurements separate from production release data.
 *
 * Privacy contract: Observe attributes must describe app state only. Never add
 * usernames, user/message/room IDs, message bodies, URLs, tokens, or filenames.
 */
export function configureObservability(): void {
  Observe.configure({
    environment: __DEV__ ? 'development' : 'production',
    dispatchInDebug: __DEV__,
    // Axonic needs a complete baseline while connection performance is being
    // stabilized. This can be reduced later if event volume approaches quota.
    sampleRate: 1,
  });
}

/** Mark the first usable auth destination as interactive for startup TTI. */
export function markAppInteractive(isAuthenticated: boolean): void {
  AppMetrics.markInteractive({
    routeName: isAuthenticated ? '/Main/Chats' : '/Login',
    params: {
      authenticated: isAuthenticated,
      dataStrategy: 'local-first',
    },
  });
}
