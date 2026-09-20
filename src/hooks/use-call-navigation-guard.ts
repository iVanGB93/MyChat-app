import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect, usePreventRemove } from '@react-navigation/native';

/** Call media belongs to the screen: do not unmount it through Back/gestures. */
export function useCallNavigationGuard(active: boolean, onBack: () => void): void {
  usePreventRemove(active, onBack);
  useFocusEffect(useCallback(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [active, onBack]));
}
