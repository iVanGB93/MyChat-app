import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Font, Radius, Spacing } from '../../theme';
import {
  DOUBLE_TAP_IMAGE_ZOOM,
  MIN_IMAGE_ZOOM,
  clampImageTranslation,
  clampImageZoom,
  touchDistance,
} from '../../utils/image-viewer-gestures';

interface FullscreenImageViewerProps {
  uri: string | null;
  accentColor: string;
  onClose: () => void;
}

type GestureMode = 'pinch' | 'pan' | null;

export default function FullscreenImageViewer({ uri, accentColor, onClose }: FullscreenImageViewerProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const scale = useRef(new Animated.Value(MIN_IMAGE_ZOOM)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scaleValue = useRef(MIN_IMAGE_ZOOM);
  const translation = useRef({ x: 0, y: 0 });
  const mode = useRef<GestureMode>(null);
  const pinchStart = useRef({ distance: 0, scale: MIN_IMAGE_ZOOM });
  const panStart = useRef({ pageX: 0, pageY: 0, x: 0, y: 0 });
  const lastTapAt = useRef(0);

  const animateTo = useCallback((nextScale: number, nextX = 0, nextY = 0) => {
    const boundedScale = clampImageZoom(nextScale);
    const boundedX = clampImageTranslation(nextX, boundedScale, width);
    const boundedY = clampImageTranslation(nextY, boundedScale, height);
    scaleValue.current = boundedScale;
    translation.current = { x: boundedX, y: boundedY };
    Animated.parallel([
      Animated.spring(scale, { toValue: boundedScale, useNativeDriver: true, damping: 20, stiffness: 220 }),
      Animated.spring(translateX, { toValue: boundedX, useNativeDriver: true, damping: 20, stiffness: 220 }),
      Animated.spring(translateY, { toValue: boundedY, useNativeDriver: true, damping: 20, stiffness: 220 }),
    ]).start();
  }, [height, scale, translateX, translateY, width]);

  const resetImage = useCallback(() => animateTo(MIN_IMAGE_ZOOM, 0, 0), [animateTo]);

  useEffect(() => {
    scale.stopAnimation();
    translateX.stopAnimation();
    translateY.stopAnimation();
    scale.setValue(MIN_IMAGE_ZOOM);
    translateX.setValue(0);
    translateY.setValue(0);
    scaleValue.current = MIN_IMAGE_ZOOM;
    translation.current = { x: 0, y: 0 };
    mode.current = null;
    lastTapAt.current = 0;
  }, [uri, scale, translateX, translateY]);

  const beginPinch = useCallback((event: GestureResponderEvent) => {
    const distance = touchDistance(event.nativeEvent.touches);
    if (distance <= 0) return;
    mode.current = 'pinch';
    pinchStart.current = { distance, scale: scaleValue.current };
  }, []);

  const beginPan = useCallback((event: GestureResponderEvent) => {
    const touch = event.nativeEvent.touches[0];
    if (!touch) return;
    mode.current = 'pan';
    panStart.current = {
      pageX: touch.pageX,
      pageY: touch.pageY,
      x: translation.current.x,
      y: translation.current.y,
    };
  }, []);

  const settleGesture = useCallback(() => {
    mode.current = null;
    if (scaleValue.current <= 1.05) {
      resetImage();
      return;
    }
    animateTo(scaleValue.current, translation.current.x, translation.current.y);
  }, [animateTo, resetImage]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponder: (event, gesture) => (
      event.nativeEvent.touches.length >= 2
      || (scaleValue.current > MIN_IMAGE_ZOOM && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2))
    ),
    onPanResponderGrant: (event) => {
      if (event.nativeEvent.touches.length >= 2) beginPinch(event);
      else beginPan(event);
    },
    onPanResponderMove: (event) => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        if (mode.current !== 'pinch') {
          beginPinch(event);
          return;
        }
        const distance = touchDistance(touches);
        if (pinchStart.current.distance <= 0 || distance <= 0) return;
        const nextScale = clampImageZoom(
          pinchStart.current.scale * distance / pinchStart.current.distance,
        );
        scaleValue.current = nextScale;
        scale.setValue(nextScale);
        return;
      }

      if (scaleValue.current <= MIN_IMAGE_ZOOM) return;
      if (mode.current !== 'pan') {
        beginPan(event);
        return;
      }
      const touch = touches[0];
      if (!touch) return;
      const nextX = clampImageTranslation(
        panStart.current.x + touch.pageX - panStart.current.pageX,
        scaleValue.current,
        width,
      );
      const nextY = clampImageTranslation(
        panStart.current.y + touch.pageY - panStart.current.pageY,
        scaleValue.current,
        height,
      );
      translation.current = { x: nextX, y: nextY };
      translateX.setValue(nextX);
      translateY.setValue(nextY);
    },
    onPanResponderRelease: settleGesture,
    onPanResponderTerminate: settleGesture,
    onPanResponderTerminationRequest: () => false,
  }), [beginPan, beginPinch, height, scale, settleGesture, translateX, translateY, width]);

  const handleImageTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapAt.current > 280) {
      lastTapAt.current = now;
      return;
    }
    lastTapAt.current = 0;
    if (scaleValue.current > MIN_IMAGE_ZOOM) resetImage();
    else animateTo(DOUBLE_TAP_IMAGE_ZOOM, 0, 0);
  }, [animateTo, resetImage]);

  const close = useCallback(() => {
    resetImage();
    onClose();
  }, [onClose, resetImage]);

  const imageStyle = {
    transform: [
      { translateX },
      { translateY },
      { scale },
    ],
  };

  return (
    <Modal
      visible={uri !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        <View style={styles.gestureArea} {...panResponder.panHandlers}>
          <Pressable
            style={styles.imagePressable}
            onPress={handleImageTap}
            accessibilityRole="imagebutton"
            accessibilityLabel="Fullscreen image. Double-tap or pinch to zoom."
          >
            {uri ? (
              <Animated.View style={[styles.imageFrame, imageStyle]}>
                <ExpoImage
                  source={{ uri }}
                  style={styles.image}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                />
              </Animated.View>
            ) : null}
          </Pressable>
        </View>

        <TouchableOpacity
          onPress={close}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Close image"
          style={[styles.closeButton, { top: insets.top + Spacing.md, borderColor: accentColor }]}
        >
          <Ionicons name="close" size={25} color="#FFFFFF" />
        </TouchableOpacity>

        <View pointerEvents="none" style={[styles.hint, { bottom: insets.bottom + Spacing.lg }]}> 
          <Ionicons name="expand-outline" size={16} color={accentColor} />
          <Text style={styles.hintText}>Pinch or double-tap to zoom · Drag to move</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.97)',
  },
  gestureArea: {
    flex: 1,
    overflow: 'hidden',
  },
  imagePressable: {
    flex: 1,
  },
  imageFrame: {
    flex: 1,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  closeButton: {
    position: 'absolute',
    right: Spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(3, 16, 31, 0.82)',
  },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '90%',
    minHeight: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: 'rgba(3, 16, 31, 0.82)',
  },
  hintText: {
    color: '#FFFFFF',
    fontSize: Font.size.xs,
  },
});
