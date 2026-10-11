import {StyleSheet} from 'react-native';
import {Font,Spacing,Radius} from '../../theme';
export const callHistoryStyles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingVertical: Spacing.xs },
  emptyContainer: { flexGrow: 1 },
  callItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingRight: Spacing.lg,
    borderBottomWidth: 0,
  },
  accentBar: {
    width: 3,
    alignSelf: 'stretch',
    marginRight: Spacing.md,
    borderRadius: 2,
  },
  callInfo: { flex: 1, marginLeft: Spacing.md },
  callName: { fontSize: Font.size.sm, fontWeight: '700', letterSpacing: 1 },
  callMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 4 },
  directionTag: {
    fontSize: Font.size.xs,
    fontWeight: '700',
    letterSpacing: 1,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  callType: { fontSize: Font.size.xs, letterSpacing: 0.8 },
  callRight: { alignItems: 'flex-end', gap: 6 },
  callTime: { fontSize: Font.size.xs, fontWeight: '600', letterSpacing: 0.5 },
  callbackBtn: {
    width: 30,
    height: 30,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  separator: { height: 1, marginLeft: 56 },
});
