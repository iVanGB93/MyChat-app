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

    // Pick the first usable file (image), or fall back to text/url.
    const file = shareIntent.files?.[0];
    const isImage = !!file && file.mimeType?.startsWith('image/');

    const params = {
      text: shareIntent.text ?? shareIntent.webUrl ?? undefined,
      imageUri: isImage ? file!.path : undefined,
      imageMime: isImage ? file!.mimeType : undefined,
    };

    navigationRef.navigate('ShareTarget', params);

    // Consume so we don't re-trigger if the screen is dismissed and the
    // user backgrounds + foregrounds the app.
    resetShareIntent(true);
  }, [hasShareIntent, shareIntent, isAuthenticated, resetShareIntent]);

  return null;
}
