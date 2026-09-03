export type KeyboardFrame = { screenY: number; height: number };

type AndroidKeyboardLayout = {
  keyboard: KeyboardFrame;
  viewportY: number;
  viewportHeight: number;
  screenHeight: number;
  windowTopInset: number;
  navigationBarInset: number;
};

/**
 * Android's RN measureInWindow subtracts the visible window's top inset;
 * Keyboard.screenY does not. Normalize before computing the remaining overlap.
 * Native adjustResize may already have consumed some or all of the IME height.
 */
export function getAndroidKeyboardOverlap({
  keyboard, viewportY, viewportHeight, screenHeight, windowTopInset, navigationBarInset,
}: AndroidKeyboardLayout): number {
  if (![keyboard.height, viewportY, viewportHeight, screenHeight, windowTopInset, navigationBarInset]
    .every(Number.isFinite) || keyboard.height <= 0 || viewportHeight <= 0 || screenHeight <= 0) return 0;

  const bottomInset = Math.max(0, navigationBarInset);
  const viewportBottom = viewportY + Math.max(0, windowTopInset) + viewportHeight;
  const hasScreenY = Number.isFinite(keyboard.screenY) && keyboard.screenY > 0 && keyboard.screenY < screenHeight;
  // RN excludes the system navigation bar from the reported IME height.
  const keyboardTop = hasScreenY
    ? keyboard.screenY
    : Math.max(0, screenHeight - bottomInset - keyboard.height);

  // A docked keyboard ends above the navigation bar (48dp on some phones).
  // That gap must not be mistaken for a floating keyboard.
  const floating = hasScreenY && keyboard.screenY + keyboard.height < screenHeight - bottomInset - 24;
  if (floating) return 0;
  return Math.min(viewportHeight, Math.max(0, viewportBottom - keyboardTop));
}
