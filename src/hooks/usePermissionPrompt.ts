/* ------------------------------------------------------------------ */
/*  usePermissionPrompt                                                 */
/*                                                                      */
/*  Requests camera / microphone at the moment a feature needs it and,  */
/*  if it's denied/blocked, shows a themed dialog explaining why and     */
/*  offering an "Open Settings" shortcut (once a user denies a runtime   */
/*  permission the OS won't prompt again — the only recovery is the      */
/*  system settings screen).                                             */
/*                                                                      */
/*  Usage:                                                              */
/*    const { ensure } = usePermissionPrompt();                          */
/*    if (!(await ensure('microphone'))) return; // user was told why    */
/* ------------------------------------------------------------------ */

import { useCallback } from 'react';
import { Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { AudioModule } from 'expo-audio';
import { useConfirm } from '../contexts/ConfirmContext';

export type PermissionKind = 'microphone' | 'camera' | 'camera+microphone';

async function requestMic(): Promise<boolean> {
  try {
    const p = await AudioModule.requestRecordingPermissionsAsync();
    return !!p.granted;
  } catch {
    return false;
  }
}

async function requestCamera(): Promise<boolean> {
  try {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    return !!p.granted;
  } catch {
    return false;
  }
}

export function usePermissionPrompt() {
  const { confirm } = useConfirm();

  /** Show a "permission needed → Open Settings" dialog. */
  const promptSettings = useCallback(
    (title: string, message: string) => {
      confirm({
        title,
        message,
        icon: 'settings-outline',
        buttons: [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => {}); } },
        ],
      });
    },
    [confirm],
  );

  /**
   * Ensure the given permission(s) are granted, requesting them if needed.
   * Returns true when granted. When denied, informs the user (with an Open
   * Settings shortcut) and returns false.
   */
  const ensure = useCallback(
    async (kind: PermissionKind): Promise<boolean> => {
      const needCam = kind === 'camera' || kind === 'camera+microphone';
      const needMic = kind === 'microphone' || kind === 'camera+microphone';

      const camOk = needCam ? await requestCamera() : true;
      const micOk = needMic ? await requestMic() : true;
      if (camOk && micOk) return true;

      const missing = [
        !camOk && needCam ? 'camera' : null,
        !micOk && needMic ? 'microphone' : null,
      ]
        .filter(Boolean)
        .join(' and ');

      promptSettings(
        'Permission needed',
        `Axonic needs ${missing} access to do this. Turn it on in Settings to continue.`,
      );
      return false;
    },
    [promptSettings],
  );

  return { ensure, promptSettings };
}
