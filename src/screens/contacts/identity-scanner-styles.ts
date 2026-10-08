import {StyleSheet} from 'react-native';
import {Font,Spacing,Radius} from '../../theme';
export const identityScannerStyles = StyleSheet.create({
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
