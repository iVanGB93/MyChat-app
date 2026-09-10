/** Display-only formatting: keep sticker markers intact in stored messages. */
export function chatPreviewText(content: string): string {
  if (/\[axonic-sticker:import:v1\]$/.test(content)) return 'Sticker';
  const builtIn = content.match(/^(.*?)\s*\[axonic-sticker:v1:[a-z0-9_-]+\]$/s);
  if (builtIn) return builtIn[1].trim() || 'Sticker';
  return content;
}
