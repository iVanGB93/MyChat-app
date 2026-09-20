import { requireOptionalNativeModule } from 'expo';
type CallAudio = { setCallSpeaker?: (enabled: boolean) => Promise<boolean>; restoreCallAudio?: () => Promise<void> };
const native = requireOptionalNativeModule<CallAudio>('AxonicAppUpdate');
let tail: Promise<unknown> = Promise.resolve();
export function setCallSpeaker(enabled: boolean): Promise<boolean> {
  const work = tail.then(() => {
    if (!native?.setCallSpeaker) throw new Error('Speaker control requires an updated Android build.');
    return native.setCallSpeaker(enabled);
  });
  tail = work.catch(() => {});
  return work;
}
export function restoreCallAudio(): void {
  tail = tail.then(() => native?.restoreCallAudio?.()).catch(() => {});
}
