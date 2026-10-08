import { StyleSheet } from 'react-native';
import { Font, Radius, Spacing } from '../../theme';

export const userInfoStyles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.md },
  hero: { alignItems: 'center', borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.lg },
  name: { marginTop: Spacing.md, fontSize: Font.size.xl, ...Font.semiBold, textAlign: 'center' },
  username: { marginTop: 3, fontSize: Font.size.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontSize: Font.size.sm, ...Font.medium },
  divider: { width: '100%', height: StyleSheet.hairlineWidth, marginVertical: Spacing.lg },
  actions: { width: '100%', flexDirection: 'row', justifyContent: 'space-evenly', gap: Spacing.md },
  action: { flex: 1, alignItems: 'center', gap: Spacing.xs },
  actionIcon: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: Font.size.sm, ...Font.medium },
  section: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md },
  sectionLabel: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 1.1 },
  bio: { fontSize: Font.size.md, lineHeight: 22 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 48 },
  detailText: { flex: 1 },
  detailLabel: { fontSize: Font.size.xs },
  detailValue: { fontSize: Font.size.md, marginTop: 2, ...Font.medium },
  setting: { minHeight: 58, borderWidth: 1, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  settingText: { flex: 1, fontSize: Font.size.md, ...Font.medium },
});
