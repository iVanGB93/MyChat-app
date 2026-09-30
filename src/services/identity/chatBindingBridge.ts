type Handler = (frame: Record<string, any>) => Promise<boolean>;
let active: { handler: Handler } | null = null;
/** Account lifecycle owns registration. A stale cleanup cannot remove a replacement session. */
export function registerChatBindingHandler(handler: Handler) {
  const registration = { handler }; active = registration;
  return () => { if (active === registration) active = null; };
}
/** Called only by the authenticated Axion composition root. Disabled until a session registers. */
export async function routeChatBindingFrame(frame: Record<string, any>) {
  try { return await active?.handler(frame) ?? false; } catch { return false; }
}
