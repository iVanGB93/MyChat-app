import {StyleSheet,Platform} from 'react-native';
import {Font,Radius} from '../../theme';
export const messageToastStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 30,
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 10,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  textCol: {
    flex: 1,
    marginRight: 8,
  },
  sender: {
    fontSize: Font.size.sm,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  content: {
    fontSize: Font.size.sm,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  close: {
    fontSize: 14,
    padding: 4,
  },
});
