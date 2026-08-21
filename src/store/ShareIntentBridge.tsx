/* ------------------------------------------------------------------ */
/*  ShareIntentBridge                                                   */
/*                                                                       */
/*  Reads incoming OS share payloads (text / URL / image) via            */
/*  expo-share-intent and pushes the user into the ShareTarget screen   */
/*  so they can pick a contact and forward it as a chat message.        */
/* ------------------------------------------------------------------ */

import { useEffect } from 'react';
import { useShareIntent } from 'expo-share-intent';

import { useAuth } from '../contexts/AuthContext';
import { navigationRef } from '../navigation/AppNavigator';
import type { RootStackParamList } from '../types';

export default function ShareIntentBridge() {
  const { isAuthenticated } = useAuth();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({
    debug: __DEV__,
    resetOnBackground: true,
  });

  useEffect(() => {
    if (!hasShareIntent) return;
    if (!isAuthenticated) return; // Wait for login, payload stays cached.
    if (!navigationRef.isReady()) {
      // Retry on next tick \u2014 nav container may still be mounting.
      const t = setTimeout(() => { /* effect re-runs on payload change */ }, 200);
      return () => clearTimeout(t);
    }

    // Keep every shared item. Android frequently hands us content:// URIs that
    // expire when the share activity closes, so ShareTarget copies each file
    // into Axonic-owned storage before it enters the sending outbox.
    const attachments: NonNullable<RootStackParamList['ShareTarget']>['attachments'] =
      (shareIntent.files ?? [])
        .filter((file) => !!file?.path)
        .map((file) => ({
          uri: file.path,
          mimeType: file.mimeType || 'application/octet-stream',
          fileName: file.fileName || 'Shared file',
          size: file.size ?? null,
          kind: file.mimeType?.startsWith('image/') ? 'image'
            : file.mimeType?.startsWith('video/') ? 'video'
            : 'file',
        }));

    const params = {
      text: shareIntent.text ?? shareIntent.webUrl ?? undefined,
      attachments: attachments.length ? attachments : undefined,
    };

    navigationRef.navigate('ShareTarget', params);

    // Consume so we don't re-trigger if the screen is dismissed and the
    // user backgrounds + foregrounds the app.
    resetShareIntent(true);
  }, [hasShareIntent, shareIntent, isAuthenticated, resetShareIntent]);

  return null;
}
