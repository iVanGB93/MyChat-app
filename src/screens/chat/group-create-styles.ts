import {StyleSheet} from 'react-native';
import {Font,Spacing,Radius} from '../../theme';
export const groupCreateStyles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  form: { paddingHorizontal: Spacing.md, paddingTop: Spacing.md },
  helper: { fontSize: Font.size.sm, marginBottom: Spacing.sm },
  list: { paddingBottom: 88 },
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  emptyText: { fontSize: Font.size.md, textAlign: 'center' },
  contact: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  contactInfo: { flex: 1, marginLeft: Spacing.md },
  contactName: { fontSize: Font.size.md, ...Font.semiBold },
  contactSub: { fontSize: Font.size.sm, marginTop: 2 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  createButton: { minHeight: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: Spacing.sm },
  createText: { color: '#fff', fontSize: Font.size.md, ...Font.semiBold },
});
