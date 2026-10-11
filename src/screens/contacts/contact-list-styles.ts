import {StyleSheet} from 'react-native';
import {Font,Spacing,Radius} from '../../theme';
export const contactListStyles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingBottom: Spacing.md },
  emptyContainer: { flexGrow: 1 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  searchInput: { marginBottom: 0 },
  scanBtn: {
    width: 48,
    minHeight: 48,
    borderRadius: Radius.md,
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
