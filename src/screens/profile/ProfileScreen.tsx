import { profileStyles as styles } from './profile-styles';
/* ------------------------------------------------------------------ */
/*  Profile Screen — futuristic cyberpunk theme                       */
/*  Features:                                                          */
/*    - Tap avatar to upload a new image                               */
/*    - Edit bio                                                       */
/*    - Account: navigates to EditAccount / ChangePassword screens     */
/*    - Theme selector                                                 */
/*    - Call connectivity selector                                     */
/*    - Notification preferences (messages / calls / sound)            */
/*    - Privacy: navigates to BlockedUsers                             */
/*    - Sessions: "logout all devices"                                 */
/*    - Danger zone: logout / delete account                           */
/* ------------------------------------------------------------------ */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Modal,
  Animated,
  Pressable,
  Share,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Font, Spacing, Radius } from '../../theme';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { APP_CONFIG } from '../../config/appConfig';
import {
  logoutAllSessions,
  updateProfile,
  uploadAvatar,
} from '../../services/authService';
import { resolveMediaUrl } from '../../services/api';
import {
  getAutoSaveReceivedMedia,
  getDownloadsDirectoryUri,
  hasAutomaticDeviceStorage,
  recoverMediaIndexFromDevice,
  retryPendingMediaExports,
  setAutoSaveReceivedMedia,
  setupDownloadsDirectory,
} from '../../services/media-export-service';
import QRCode from 'react-native-qrcode-svg';
import { flushDeletedMedia } from '../../services/deleted-media-cleanup';
import { getMediaDeletionJobs } from '../../services/localMessageStore';
import Avatar from '../../components/ui/Avatar';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import type { ConnectivityMode, RootStackParamList } from '../../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ProfileScreen() {
  const { user, logout, refreshUser } = useAuth();
  const { colors: Colors, preference, setPreference } = useTheme();
  const { confirm, alert } = useConfirm();
  const navigation = useNavigation<Nav>();

  const [bio, setBio] = useState(user?.bio ?? '');
  const [displayName, setDisplayName] = useState(user?.display_name ?? user?.username ?? '');
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [discoverByUsername, setDiscoverByUsername] = useState<boolean>(
    user?.discoverable_by_username ?? true,
  );
  const [discoverByEmail, setDiscoverByEmail] = useState<boolean>(
    user?.discoverable_by_email ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [connectivityMode, setConnectivityModeState] = useState<ConnectivityMode>(
    user?.connectivity_mode ?? 'auto'
  );
  const [savingConnectivity, setSavingConnectivity] = useState(false);

  // Notification prefs (mirrored locally for immediate toggle UI)
  const [notifMessages, setNotifMessages] = useState<boolean>(user?.notif_messages_enabled ?? true);
  const [notifCalls, setNotifCalls] = useState<boolean>(user?.notif_calls_enabled ?? true);
  const [notifSound, setNotifSound] = useState<boolean>(user?.notif_sound_enabled ?? true);
  const [notifOfflineEmail, setNotifOfflineEmail] = useState<boolean>(user?.notif_offline_email_enabled ?? true);
  const [autoSaveMedia, setAutoSaveMedia] = useState(true);
  const [downloadsReady, setDownloadsReady] = useState(false);
  const [mediaSettingsLoaded, setMediaSettingsLoaded] = useState(false);
  const [configuringDownloads, setConfiguringDownloads] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([getAutoSaveReceivedMedia(), getDownloadsDirectoryUri()])
      .then(([enabled, directoryUri]) => {
        if (!active) return;
        setAutoSaveMedia(enabled);
        setDownloadsReady(hasAutomaticDeviceStorage() || !!directoryUri);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setMediaSettingsLoaded(true);
      });
    return () => { active = false; };
  }, []);

  const handleAutoSaveMedia = async (enabled: boolean) => {
    setAutoSaveMedia(enabled);
    try {
      await setAutoSaveReceivedMedia(enabled);
    } catch {
      setAutoSaveMedia(!enabled);
      alert('Could not save preference', 'Please try again.');
    }
  };

  const handleSetupDownloads = async () => {
    if (configuringDownloads) return;
    setConfiguringDownloads(true);
    try {
      if (!hasAutomaticDeviceStorage()) {
        const uri = await setupDownloadsDirectory();
        if (!uri) {
          alert('Folder not selected', 'Select the Downloads folder so Axonic can create and use Downloads/Axonic.');
          return;
        }
      }
      setDownloadsReady(true);
      const recovered = await recoverMediaIndexFromDevice(true);
      void retryPendingMediaExports();
      alert(
        'Device media ready',
        recovered > 0
          ? `Axonic found and indexed ${recovered} existing media file${recovered === 1 ? '' : 's'}.`
          : 'New received media saves automatically to Axonic folders. If saving fails, it stays safely inside the app.',
      );
    } catch (error) {
      console.warn('[Profile] downloads folder setup failed:', error);
      alert('Could not prepare Downloads', 'Please select the Downloads folder and try again.');
    } finally {
      setConfiguringDownloads(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({ bio });
      await refreshUser();
      alert('Saved', 'Profile updated');
    } catch {
      alert('Error', 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDisplayName = async () => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      alert('Validation', 'Display name cannot be empty.');
      return;
    }
    setSavingDisplayName(true);
    try {
      await updateProfile({ display_name: trimmed });
      await refreshUser();
      alert('Saved', 'Display name updated');
    } catch {
      alert('Error', 'Failed to update display name');
    } finally {
      setSavingDisplayName(false);
    }
  };

  const handleShareTag = async () => {
    const tag = user?.user_tag;
    if (!tag) return;
    const safeTag = encodeURIComponent(tag);
    const inviteWebUrl = `${APP_CONFIG.SERVER_URL}/add/${safeTag}`;
    const inviteDeepLink = `axonic://add/${safeTag}`;
    try {
      await Share.share({
        message: `Add me on Axonic: ${inviteWebUrl}\n\nIf the link does not open the app, use: ${inviteDeepLink}`,
      });
    } catch {
      /* user dismissed */
    }
  };

  const persistDiscovery = async (
    setter: (v: boolean) => void,
    field: 'discoverable_by_username' | 'discoverable_by_email',
    prevValue: boolean,
    nextValue: boolean,
  ) => {
    setter(nextValue);
    try {
      await updateProfile({ [field]: nextValue } as any);
      await refreshUser();
    } catch {
      setter(prevValue);
      alert('Error', 'Failed to update discoverability preference');
    }
  };

  const handleSaveConnectivity = async (mode: ConnectivityMode) => {
    setConnectivityModeState(mode);
    setSavingConnectivity(true);
    try {
      await updateProfile({ connectivity_mode: mode } as any);
      await refreshUser();
    } catch {
      alert('Error', 'Failed to save connectivity preference');
    } finally {
      setSavingConnectivity(false);
    }
  };

  /* ------------------------ Notification toggles ------------------------ */
  const persistNotifPref = async (
    setter: (v: boolean) => void,
    field: 'notif_messages_enabled' | 'notif_calls_enabled' | 'notif_sound_enabled' | 'notif_offline_email_enabled',
    prevValue: boolean,
    nextValue: boolean,
  ) => {
    setter(nextValue);
    try {
      await updateProfile({ [field]: nextValue } as any);
      await refreshUser();
    } catch {
      setter(prevValue);
      alert('Error', 'Failed to update notification preference');
    }
  };

  /* ------------------------ Avatar upload ------------------------ */
  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      alert('Permission needed', 'Please allow photo library access to change your avatar.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    await doUpload(result.assets[0]);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      alert('Permission needed', 'Please allow camera access to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      cameraType: ImagePicker.CameraType.front,
    });
    if (result.canceled || !result.assets?.length) return;
    await doUpload(result.assets[0]);
  };

  const doUpload = async (asset: ImagePicker.ImagePickerAsset) => {
    setUploadingAvatar(true);
    try {
      await uploadAvatar(asset.uri, asset.mimeType ?? 'image/jpeg');
      await refreshUser();
    } catch (err) {
      console.warn('[Profile] avatar upload failed', err);
      alert('Error', 'Failed to upload avatar. Please try again.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleChangeAvatar = () => setAvatarPickerOpen(true);

  /* ------------------------ Sessions / danger zone ------------------------ */
  const handleLogout = () => {
    confirm({
      title: 'Disconnect',
      message: 'Are you sure you want to sign out?',
      icon: 'log-out-outline',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: logout },
      ],
    });
  };

  const handleLogoutAll = () => {
    confirm({
      title: 'Logout everywhere',
      message: 'This will sign you out on every device, including this one. Continue?',
      icon: 'warning-outline',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out all',
          style: 'destructive',
          onPress: async () => {
            try {
              await logoutAllSessions();
            } catch {
              /* still log out locally even if server call fails */
            }
            await logout();
          },
        },
      ],
    });
  };

  const handleDeleteAccount = () => {
    // Funnel everyone (iOS + Android) to the themed EditAccount
    // screen so the password-confirmation UX matches the rest of the
    // app and works identically on both platforms.
    navigation.navigate('EditAccount');
  };

  if (!user) return null;

  const avatarUri = resolveMediaUrl(user.avatar);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: Colors.background }]}
      contentContainerStyle={styles.content}
    >
      {mediaSettingsLoaded && !downloadsReady ? (
        <View
          style={[
            styles.mediaSetupNotice,
            {
              backgroundColor: Colors.highlight,
              borderColor: Colors.primary,
              shadowColor: Colors.primary,
            },
          ]}
        >
          <View style={styles.mediaSetupHeading}>
            <View style={[styles.mediaSetupIcon, { backgroundColor: Colors.surface, borderColor: Colors.primary }]}>
              <Ionicons name="folder-open-outline" size={22} color={Colors.primary} />
            </View>
            <View style={styles.mediaSetupCopy}>
              <Text style={[styles.mediaSetupTitle, { color: Colors.text }]}>KEEP ALL RECEIVED MEDIA</Text>
              <Text style={[styles.mediaSetupDescription, { color: Colors.textSecondary }]}>
                Photos and videos save to Gallery automatically. Choose a folder once to keep voice messages and documents in Downloads/Axonic.
              </Text>
            </View>
          </View>
          <Button
            title={configuringDownloads ? 'SETTING UP…' : 'CHOOSE DOWNLOADS FOLDER'}
            onPress={handleSetupDownloads}
            loading={configuringDownloads}
            icon={!configuringDownloads ? <Ionicons name="folder-outline" size={19} color={Colors.textInverse} /> : undefined}
            style={styles.mediaSetupButton}
          />
        </View>
      ) : null}

      {/* Avatar section */}
      <View style={[styles.avatarSection, { backgroundColor: Colors.surface, borderBottomColor: Colors.neonBorder }]}>
        <TouchableOpacity onPress={handleChangeAvatar} activeOpacity={0.85} disabled={uploadingAvatar}>
          <View style={{ opacity: uploadingAvatar ? 0.5 : 1 }}>
            <Avatar name={user.username} uri={avatarUri} size={100} />
            <View style={[styles.avatarEditBadge, { backgroundColor: Colors.surface, borderColor: Colors.primary, shadowColor: Colors.primary }]}>
              <Ionicons name="camera" size={14} color={Colors.primary} />
            </View>
          </View>
        </TouchableOpacity>
        <Text style={[styles.username, { color: Colors.primary }]}>
          {(user.display_name?.trim() || user.username).toUpperCase()}
        </Text>
        <Text style={[styles.email, { color: Colors.textSecondary }]}>@{user.username}</Text>
        <View style={[styles.statusBadge, { backgroundColor: Colors.surface, borderColor: Colors.online, shadowColor: Colors.online }]}>
          <View style={[styles.statusDot, { backgroundColor: Colors.online, shadowColor: Colors.online }]} />
          <Text style={[styles.statusText, { color: Colors.online }]}>ONLINE</Text>
        </View>
      </View>

      {/* Identity card */}
      <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ IDENTITY</Text>
        <Text style={[styles.label, { color: Colors.textSecondary }]}>DISPLAY NAME</Text>
        <Input
          placeholder="How others see your name"
          value={displayName}
          onChangeText={setDisplayName}
          maxLength={50}
          autoCapitalize="words"
        />
        <Button
          title="SAVE NAME"
          onPress={handleSaveDisplayName}
          loading={savingDisplayName}
          style={styles.saveBtn}
        />

        {user.user_tag ? (
          <>
            <TouchableOpacity
              onPress={handleShareTag}
              activeOpacity={0.75}
              style={[
                styles.tagBox,
                { borderColor: Colors.accent, backgroundColor: Colors.highlight, shadowColor: Colors.accent },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: Colors.textSecondary, marginBottom: 2 }]}>
                  YOUR TAG
                </Text>
                <Text style={[styles.tagValue, { color: Colors.accent }]}>{user.user_tag}</Text>
                <Text style={[styles.tagHint, { color: Colors.textTertiary }]}>
                  Tap to share — friends can find you with this tag.
                </Text>
              </View>
              <Ionicons name="share-outline" size={20} color={Colors.accent} />
            </TouchableOpacity>

            <View style={[styles.qrBox, { borderColor: Colors.neonBorder, backgroundColor: '#ffffff' }]}>
              <QRCode
                value={`${APP_CONFIG.SERVER_URL}/add/${encodeURIComponent(user.user_tag)}`}
                size={180}
                backgroundColor="#ffffff"
                color="#000000"
              />
            </View>
            <Text style={[styles.qrHint, { color: Colors.textTertiary }]}>
              Friends can scan this code to add you instantly.
            </Text>
          </>
        ) : null}
      </View>

      {/* About card */}
      <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ ABOUT</Text>
        <Input
          placeholder="Write something about yourself…"
          value={bio}
          onChangeText={setBio}
          multiline
          maxLength={200}
        />
        <Button title="SAVE" onPress={handleSave} loading={saving} style={styles.saveBtn} />
      </View>

      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Network"
        onPress={() => navigation.navigate('Network')}
        style={[styles.card, { backgroundColor: Colors.card, borderColor: Colors.border }]}>
        <Text style={[styles.cardTitle, { color: Colors.primary }]}>◎ NETWORK</Text>
        <Text style={{ color: Colors.textSecondary }}>Connections, participation, and network information →</Text>
      </TouchableOpacity>

      {/* Account card */}
      <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ ACCOUNT</Text>
        <View style={[styles.infoRow, { borderBottomColor: Colors.divider }]}>
          <Text style={[styles.infoLabel, { color: Colors.textSecondary }]}>USERNAME</Text>
          <Text style={[styles.infoValue, { color: Colors.text }]}>{user.username}</Text>
        </View>
        <View style={[styles.infoRow, { borderBottomColor: Colors.divider }]}>
          <Text style={[styles.infoLabel, { color: Colors.textSecondary }]}>EMAIL</Text>
          <Text style={[styles.infoValue, { color: Colors.text }]}>{user.email}</Text>
        </View>
        <View style={[styles.infoRow, { borderBottomColor: Colors.divider }]}>
          <Text style={[styles.infoLabel, { color: Colors.textSecondary }]}>NODE ID</Text>
          <Text style={[styles.infoValue, { color: Colors.text }]}>{user.id}</Text>
        </View>
        <ActionRow
          label="EDIT USERNAME / EMAIL"
          icon="create-outline"
          colors={Colors}
          onPress={() => navigation.navigate('EditAccount')}
        />
        <ActionRow
          label="CHANGE PASSWORD"
          icon="key-outline"
          colors={Colors}
          onPress={() => navigation.navigate('ChangePassword')}
          last
        />
      </View>

      {/* Local chat storage */}
      <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ DEVICE CHAT STORAGE</Text>
        <ActionRow
          label="MANAGE CHAT STORAGE"
          icon="server-outline"
          colors={Colors}
          onPress={() => navigation.navigate('ChatStorage')}
          last
        />
      </View>

      {/* Received-media export */}
      <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ RECEIVED MEDIA</Text>
        <ToggleRow
          label="AUTO-SAVE RECEIVED MEDIA"
          desc="Keep one permanent copy: pictures and videos in Gallery; voice notes and files in Downloads/Axonic"
          value={autoSaveMedia}
          colors={Colors}
          onValueChange={handleAutoSaveMedia}
        />
        <ActionRow
          label="FINISH MEDIA CLEANUP"
          icon="trash-outline"
          colors={Colors}
          onPress={async () => {
            try {
              await flushDeletedMedia(true);
              const remaining = await getMediaDeletionJobs();
              alert('Media cleanup', remaining.length
                ? 'Some files could not be removed. You can delete them in Gallery or Files; your chat deletions remain in effect.'
                : 'No pending media cleanup remains.');
            } catch { alert('Media cleanup', 'Could not complete cleanup. Your files have been kept.'); }
          }}
        />
        <ActionRow
          label={configuringDownloads ? 'CHECKING DEVICE MEDIA…' : hasAutomaticDeviceStorage() ? 'RECOVER OLDER GALLERY MEDIA' : downloadsReady ? 'DEVICE MEDIA ACCESS READY' : 'SET UP / RECOVER DEVICE MEDIA'}
          icon={downloadsReady ? 'checkmark-circle-outline' : 'folder-open-outline'}
          colors={Colors}
          onPress={handleSetupDownloads}
          last
        />
      </View>

      {/* Theme card */}
      <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ DISPLAY</Text>
        <View style={styles.themeRow}>
          {([
            { key: 'system' as const, label: 'SYSTEM' },
            { key: 'light' as const,  label: 'LIGHT' },
            { key: 'dark' as const,   label: 'DARK' },
          ]).map((opt) => {
            const active = preference === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.themeOption,
                  {
                    borderColor: active ? Colors.primary : Colors.neonBorder,
                    backgroundColor: active ? Colors.highlight : 'transparent',
                    shadowColor: active ? Colors.primary : 'transparent',
                  },
                ]}
                onPress={() => setPreference(opt.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.themeLabel, { color: active ? Colors.primary : Colors.textSecondary }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Notifications card */}
      <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ NOTIFICATIONS</Text>
        <ToggleRow
          label="MESSAGE PUSH"
          desc="Receive a notification when someone messages you"
          value={notifMessages}
          colors={Colors}
          onValueChange={(v) => persistNotifPref(setNotifMessages, 'notif_messages_enabled', notifMessages, v)}
        />
        <ToggleRow
          label="CALL PUSH"
          desc="Receive a notification for incoming calls"
          value={notifCalls}
          colors={Colors}
          onValueChange={(v) => persistNotifPref(setNotifCalls, 'notif_calls_enabled', notifCalls, v)}
        />
        <ToggleRow
          label="IN-APP SOUND"
          desc="Play a sound for new messages and calls"
          value={notifSound}
          colors={Colors}
          onValueChange={(v) => persistNotifPref(setNotifSound, 'notif_sound_enabled', notifSound, v)}
        />
        <ToggleRow
          label="OFFLINE EMAIL"
          desc="Email me when a contact messages me and the app cannot reach me"
          value={notifOfflineEmail}
          colors={Colors}
          onValueChange={(v) => persistNotifPref(setNotifOfflineEmail, 'notif_offline_email_enabled', notifOfflineEmail, v)}
          last
        />
      </View>

      {/* Connectivity card */}
      <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ CALL CONNECTIVITY</Text>
        <Text style={[styles.connectivityDesc, { color: Colors.textSecondary }]}>
          Controls how call connections are established. Auto tries P2P first and falls back to relay.
        </Text>
        <View style={styles.connectivityRow}>
          {([
            { key: 'auto' as ConnectivityMode,   label: 'AUTO',   desc: 'P2P → relay' },
            { key: 'p2p' as ConnectivityMode,    label: 'P2P',    desc: 'Direct only' },
            { key: 'server' as ConnectivityMode, label: 'RELAY',  desc: 'Server only' },
          ]).map((opt) => {
            const active = connectivityMode === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.connectivityOption,
                  {
                    borderColor: active ? Colors.primary : Colors.neonBorder,
                    backgroundColor: active ? Colors.highlight : 'transparent',
                    opacity: savingConnectivity ? 0.6 : 1,
                    shadowColor: active ? Colors.primary : 'transparent',
                  },
                ]}
                onPress={() => handleSaveConnectivity(opt.key)}
                disabled={savingConnectivity}
                activeOpacity={0.7}
              >
                <Text style={[styles.connectivityLabel, { color: active ? Colors.primary : Colors.text }]}>
                  {opt.label}
                </Text>
                <Text style={[styles.connectivitySubLabel, { color: Colors.textSecondary }]}>
                  {opt.desc}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Privacy card */}
      <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ PRIVACY</Text>
        <ToggleRow
          label="DISCOVERABLE BY USERNAME"
          desc="Allow others to find you by searching your username or display name"
          value={discoverByUsername}
          colors={Colors}
          onValueChange={(v) =>
            persistDiscovery(setDiscoverByUsername, 'discoverable_by_username', discoverByUsername, v)
          }
        />
        <ToggleRow
          label="DISCOVERABLE BY EMAIL"
          desc="Allow others to find you by your exact email address"
          value={discoverByEmail}
          colors={Colors}
          onValueChange={(v) =>
            persistDiscovery(setDiscoverByEmail, 'discoverable_by_email', discoverByEmail, v)
          }
        />
        <ActionRow
          label="BLOCKED USERS"
          icon="ban-outline"
          colors={Colors}
          onPress={() => navigation.navigate('BlockedUsers')}
          last
        />
      </View>

      {/* Sessions card */}
      <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.cardTitle, { color: Colors.primary }]}>◈ SESSIONS</Text>
        <ActionRow
          label="SIGN OUT ALL DEVICES"
          icon="log-out-outline"
          colors={Colors}
          onPress={handleLogoutAll}
          last
        />
      </View>

      {/* Logout */}
      <TouchableOpacity
        style={[styles.logoutBtn, { borderColor: Colors.error, shadowColor: Colors.error }]}
        onPress={handleLogout}
        activeOpacity={0.7}
      >
        <Text style={[styles.logoutText, { color: Colors.error }]}>◉ DISCONNECT</Text>
      </TouchableOpacity>

      {/* Delete account */}
      <TouchableOpacity
        style={[styles.deleteBtn, { borderColor: Colors.error }]}
        onPress={handleDeleteAccount}
        activeOpacity={0.7}
      >
        <Text style={[styles.deleteText, { color: Colors.error }]}>DELETE ACCOUNT</Text>
      </TouchableOpacity>

      <AvatarPickerSheet
        visible={avatarPickerOpen}
        onClose={() => setAvatarPickerOpen(false)}
        onTakePhoto={takePhoto}
        onPickFromLibrary={pickFromLibrary}
      />

      {/* App version */}
      <Text style={[styles.versionText, { color: Colors.textTertiary }]}>
        Axonic v{Constants.expoConfig?.version ?? '—'}
      </Text>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  Avatar picker — themed bottom sheet                                */
/* ------------------------------------------------------------------ */

function AvatarPickerSheet({
  visible,
  onClose,
  onTakePhoto,
  onPickFromLibrary,
}: {
  visible: boolean;
  onClose: () => void;
  onTakePhoto: () => void;
  onPickFromLibrary: () => void;
}) {
  const { colors: Colors } = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(400)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 11 }),
        Animated.timing(backdrop, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else {
      translateY.setValue(400);
      backdrop.setValue(0);
    }
  }, [visible, translateY, backdrop]);

  const dismiss = (after?: () => void) => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: 400, duration: 200, useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      onClose();
      if (after) after();
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={() => dismiss()}
    >
      <Animated.View style={[sheetStyles.backdrop, { opacity: backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss()} />
      </Animated.View>
      <Animated.View
        style={[
          sheetStyles.sheet,
          {
            backgroundColor: Colors.surface,
            borderColor: Colors.neonBorder,
            shadowColor: Colors.primary,
            // Respect 3-button nav bar / home indicator inset so the
            // cancel button isn't covered by the system bar.
            paddingBottom: Spacing.xl + insets.bottom,
            transform: [{ translateY }],
          },
        ]}
      >
        <View style={[sheetStyles.handle, { backgroundColor: Colors.neonBorder }]} />
        <Text style={[sheetStyles.title, { color: Colors.primary }]}>◈ CHANGE AVATAR</Text>
        <Text style={[sheetStyles.subtitle, { color: Colors.textSecondary }]}>
          Pick a source for your new profile picture
        </Text>

        <SheetOption
          icon="camera-outline"
          label="TAKE PHOTO"
          desc="Use your front camera"
          colors={Colors}
          onPress={() => dismiss(onTakePhoto)}
        />
        <SheetOption
          icon="images-outline"
          label="CHOOSE FROM LIBRARY"
          desc="Pick an existing image"
          colors={Colors}
          onPress={() => dismiss(onPickFromLibrary)}
        />

        <TouchableOpacity
          style={[sheetStyles.cancel, { borderColor: Colors.neonBorder }]}
          onPress={() => dismiss()}
          activeOpacity={0.7}
        >
          <Text style={[sheetStyles.cancelText, { color: Colors.textSecondary }]}>CANCEL</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

function SheetOption({
  icon,
  label,
  desc,
  colors,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  desc: string;
  colors: any;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[sheetStyles.option, { borderColor: colors.neonBorder, backgroundColor: colors.highlight }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={[sheetStyles.optionIcon, { borderColor: colors.primary, shadowColor: colors.primary }]}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[sheetStyles.optionLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[sheetStyles.optionDesc, { color: colors.textSecondary }]}>{desc}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/*  Small row helpers                                                  */
/* ------------------------------------------------------------------ */

function ActionRow({
  label,
  icon,
  colors,
  onPress,
  last,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  colors: any;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.actionRow,
        { borderBottomColor: colors.divider, borderBottomWidth: last ? 0 : 1 },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.actionLeft}>
        <Ionicons name={icon} size={18} color={colors.primary} style={{ marginRight: Spacing.md }} />
        <Text style={[styles.actionLabel, { color: colors.text }]}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

function ToggleRow({
  label,
  desc,
  value,
  onValueChange,
  colors,
  last,
}: {
  label: string;
  desc: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  colors: any;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.toggleRow,
        { borderBottomColor: colors.divider, borderBottomWidth: last ? 0 : 1 },
      ]}
    >
      <View style={{ flex: 1, paddingRight: Spacing.sm }}>
        <Text style={[styles.toggleLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.toggleDesc, { color: colors.textSecondary }]}>{desc}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.divider, true: colors.primary }}
        thumbColor={value ? colors.surface : colors.textTertiary}
      />
    </View>
  );
}


const sheetStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.md,
    opacity: 0.6,
  },
  title: {
    fontSize: Font.size.xs,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: Font.size.xs,
    textAlign: 'center',
    marginTop: Spacing.xs,
    marginBottom: Spacing.lg,
    letterSpacing: 0.3,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  optionLabel: {
    fontSize: Font.size.sm,
    fontWeight: '700',
    letterSpacing: 1,
  },
  optionDesc: {
    fontSize: Font.size.xs,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  cancel: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  cancelText: {
    fontSize: Font.size.xs,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
});
