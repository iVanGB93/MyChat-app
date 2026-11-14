import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, Linking, PermissionsAndroid, Platform, Text, TouchableOpacity, View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {Ionicons} from '@expo/vector-icons';
import notifee, {AuthorizationStatus} from '@notifee/react-native';
import {AudioModule} from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import {useTheme} from '../../contexts/ThemeContext';
import {t} from '../../localization/language';
import {profileStyles as styles} from './profile-styles';

async function requestAccess(
  read: () => Promise<{granted: boolean; canAskAgain: boolean}>,
  request: () => Promise<{granted: boolean; canAskAgain: boolean}>,
) {
  const permission = await read();
  if (permission.granted || !permission.canAskAgain) {
    await Linking.openSettings();
  } else {
    await request();
  }
}

const permissions = [
  {
    label: 'Notifications',
    icon: 'notifications-outline',
    read: async () => (await notifee.getNotificationSettings()).authorizationStatus >= AuthorizationStatus.AUTHORIZED,
    open: async () => {
      const settings = await notifee.getNotificationSettings();
      if (Platform.OS === 'android' && Number(Platform.Version) >= 33 && settings.authorizationStatus < AuthorizationStatus.AUTHORIZED) {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) await notifee.openNotificationSettings();
        return;
      }
      if (settings.authorizationStatus !== AuthorizationStatus.NOT_DETERMINED) {
        await notifee.openNotificationSettings();
        return;
      }
      await notifee.requestPermission();
    },
  },
  {
    label: 'Camera',
    icon: 'camera-outline',
    read: async () => (await ImagePicker.getCameraPermissionsAsync()).granted,
    open: () => requestAccess(ImagePicker.getCameraPermissionsAsync, ImagePicker.requestCameraPermissionsAsync),
  },
  {
    label: 'Microphone',
    icon: 'mic-outline',
    read: async () => (await AudioModule.getRecordingPermissionsAsync()).granted,
    open: () => requestAccess(() => AudioModule.getRecordingPermissionsAsync(), () => AudioModule.requestRecordingPermissionsAsync()),
  },
] as const;

export default function ProfilePermissions() {
  const {colors} = useTheme();
  const focused = useIsFocused();
  const [statuses, setStatuses] = useState<(boolean | null)[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);
  const acting = useRef(false);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    const next = await Promise.all(permissions.map(permission => permission.read().catch(() => null)));
    if (id === requestId.current) setStatuses(next);
  }, []);

  useEffect(() => {
    if (!focused) return;
    void refresh();
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => {
      listener.remove();
      requestId.current++;
    };
  }, [focused, refresh]);

  async function open(permission: typeof permissions[number]) {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await permission.open();
    } catch {
      setFailed(true);
    } finally {
      void refresh();
      acting.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={[styles.card, {backgroundColor: colors.surface, borderColor: colors.neonBorder}]}>
      <Text style={[styles.cardTitle, {color: colors.headerText}]}>{t('◈ DEVICE PERMISSIONS')}</Text>
      {permissions.map((permission, index) => (
        <TouchableOpacity key={permission.label} accessibilityRole="button" disabled={busy}
          style={styles.actionRow} onPress={() => void open(permission)}>
          <View style={styles.actionLeft}>
            <Ionicons name={permission.icon} size={20} color={colors.headerText}/>
            <View style={{flex: 1}}>
              <Text style={[styles.actionLabel, {color: colors.text}]}>{t(permission.label)}</Text>
              <Text style={[styles.toggleDesc, {color: colors.textSecondary}]}>
                {statuses[index] === true ? t('Allowed') : statuses[index] === false ? t('Not allowed') : statuses[index] === null ? t('Status unavailable') : t('Checking…')}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textTertiary}/>
        </TouchableOpacity>
      ))}
      {failed && <Text accessibilityLiveRegion="polite" style={[styles.toggleDesc, {color: colors.error}]}>{t('Could not open permission settings.')}</Text>}
    </View>
  );
}
