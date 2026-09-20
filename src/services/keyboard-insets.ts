import { requireOptionalNativeModule } from 'expo';
type KeyboardSnapshot = { visible: boolean; overlap: number };
const native = requireOptionalNativeModule<{
  getKeyboardOverlap?: (viewTag: number) => Promise<KeyboardSnapshot | null>;
}>('AxonicAppUpdate');

export const hasLiveKeyboardInsets = () => typeof native?.getKeyboardOverlap === 'function';
export async function readKeyboardInsets(tag: number | null): Promise<KeyboardSnapshot | null> {
  if (tag == null || !native?.getKeyboardOverlap) return null;
  try {
    const snapshot = await native.getKeyboardOverlap(tag);
    return snapshot && Number.isFinite(snapshot.overlap) && snapshot.overlap >= 0 ? snapshot : null;
  } catch { return null; }
}
