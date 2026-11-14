import {Chrome} from '../../theme';
import {StyleSheet} from 'react-native';
import {Font,Spacing} from '../../theme';
export const contactListStyles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingBottom: Spacing.md },
  emptyContainer: { flexGrow: 1 },
  fixedControls: {
    position: 'absolute',
    zIndex: 2,
    paddingBottom: Spacing.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  searchInput: { marginBottom: 0 },
  scanBtn: {
    width: 48,
    minHeight: 48,
    borderRadius: Chrome.controlRadius,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  info: { flex: 1, marginLeft: Spacing.md },
  name: { fontSize: Font.size.md, ...Font.semiBold },
  sub: { fontSize: Font.size.sm, marginTop: 1 },
  separator: { height: 1, marginLeft: 76 },
});
