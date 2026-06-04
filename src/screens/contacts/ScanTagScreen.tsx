/* ------------------------------------------------------------------ */
/*  ScanTagScreen — live camera viewfinder that scans Axonic user-tag */
/*  QR codes (axonic://add/<tag>) and returns to Contacts with the    */
/*  scanned tag pre-filled in the search input.                        */
/* ------------------------------------------------------------------ */

import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Font, Radius, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import Button from '../../components/ui/Button';
import type { RootStackParamList } from '../../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const DEEP_LINK_PREFIX = 'axonic://add/';
const TAG_REGEX = /^AXN-[A-Z0-9]{4}$/;

function extractTag(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const normalized = trimmed.toUpperCase();
  if (normalized.startsWith(DEEP_LINK_PREFIX.toUpperCase())) {
    const tag = normalized.slice(DEEP_LINK_PREFIX.length);
    return TAG_REGEX.test(tag) ? tag : null;
  }
  return TAG_REGEX.test(normalized) ? normalized : null;
}

export default function ScanTagScreen() {
  const { colors: Colors } = useTheme();
  const { alert } = useConfirm();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  // Latch: once we've handled a scan we ignore subsequent frames so the
  // alert doesn't fire repeatedly while the user is dismissing it.
  const handledRef = useRef(false);

  const handleBarcode = useCallback(
    ({ data }: { data: string }) => {
      if (handledRef.current) return;
      const tag = extractTag(data);
      if (!tag) {
        // Don't latch on invalid scans — the user may move the camera to
        // a valid code. Surface a transient hint only once.
        return;
      }
      handledRef.current = true;
      navigation.replace('Contacts', { prefillTag: tag });
    },
    [navigation],
  );

  if (!permission) {
    return (
      <View style={[styles.center, { backgroundColor: Colors.background }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: Colors.background, padding: Spacing.xl }]}>
        <Ionicons name="camera-outline" size={48} color={Colors.primary} />
        <Text style={[styles.permissionTitle, { color: Colors.text }]}>
          Camera access required
        </Text>
        <Text style={[styles.permissionDesc, { color: Colors.textSecondary }]}>
          Axonic needs your camera to scan friend tags. Your camera stream is
          processed on-device and never uploaded.
        </Text>
        <Button
          title="GRANT CAMERA ACCESS"
          onPress={async () => {
            const res = await requestPermission();
            if (!res.granted) {
              alert(
                'Permission denied',
                'You can enable camera access from your system settings.',
              );
            }
          }}
          style={{ marginTop: Spacing.lg, alignSelf: 'stretch' }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleBarcode}
      />

      {/* Reticle overlay */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={[styles.reticle, { borderColor: Colors.primary, shadowColor: Colors.primary }]} />
      </View>

      {/* Hint */}
      <View style={[styles.hintBox, { top: insets.top + Spacing.lg }]}>
        <Text style={styles.hintText}>
          Point your camera at an Axonic tag QR code
        </Text>
      </View>

      {/* Controls */}
      <View style={[styles.controls, { bottom: insets.bottom + Spacing.xl }]}>
        <TouchableOpacity
          style={[styles.controlBtn, { borderColor: Colors.neonBorder }]}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.controlBtn,
            {
              borderColor: torch ? Colors.accent : Colors.neonBorder,
              backgroundColor: torch ? 'rgba(255,255,255,0.15)' : 'transparent',
            },
          ]}
          onPress={() => setTorch((t) => !t)}
          activeOpacity={0.7}
        >
          <Ionicons name={torch ? 'flashlight' : 'flashlight-outline'} size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticle: {
    width: 260,
    height: 260,
    borderWidth: 2,
    borderRadius: Radius.lg,
    shadowOpacity: 0.7,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  hintBox: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: Radius.md,
  },
  hintText: {
    color: '#fff',
    fontSize: Font.size.sm,
    textAlign: 'center',
    letterSpacing: 1,
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: Spacing.xl,
  },
  controlBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionTitle: {
    marginTop: Spacing.lg,
    fontSize: Font.size.lg,
    fontWeight: '700',
    letterSpacing: 1,
  },
  permissionDesc: {
    marginTop: Spacing.sm,
    fontSize: Font.size.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
});
