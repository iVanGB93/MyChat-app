import {StyleSheet} from 'react-native';
import {Font,Spacing,Radius} from '../../theme';
export const chatStorageStyles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  totalCard: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.lg },
  title: { fontSize: Font.size.xs, fontWeight: '800', letterSpacing: 1.5 },
  hint: { fontSize: Font.size.xs, marginTop: 3 },
  total: { marginTop: Spacing.lg, borderWidth: 1, borderRadius: Radius.md, padding: Spacing.lg, alignItems: 'center' },
  totalValue: { fontSize: Font.size.xxl, fontWeight: '800', letterSpacing: 1 },
  totalLabel: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 1.2, marginTop: 2 },
  detail: { fontSize: Font.size.xs, marginTop: 6 },
  error: { textAlign: 'center', paddingVertical: Spacing.xl, fontSize: Font.size.sm },
  sectionTitle: { marginTop: Spacing.xl, marginBottom: Spacing.sm, fontSize: Font.size.xs, fontWeight: '800', letterSpacing: 1.5 },
  list: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.lg },
  room: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.md },
  roomInfo: { flex: 1, paddingRight: Spacing.md },
  roomName: { flex: 1, fontSize: Font.size.md, fontWeight: '700' },
  roomMeta: { fontSize: Font.size.xs, marginTop: 3 },
  empty: { textAlign: 'center', paddingVertical: Spacing.xl, fontSize: Font.size.sm },
  footnote: { fontSize: Font.size.xs, lineHeight: 17, marginTop: Spacing.lg, textAlign: 'center', paddingHorizontal: Spacing.md },
});
