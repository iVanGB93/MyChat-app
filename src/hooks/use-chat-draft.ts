import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { loadChatDraft, saveChatDraft } from '../services/chat-drafts';

export function useChatDraft(ownerId: number | undefined, roomId: string): [string, (text: string) => void] {
  const scope = `${ownerId}:${roomId}`;
  const [value, setValue] = useState({ scope, text: '' });
  const session = useRef<{ scope: string; update: (text: string) => void } | null>(null);
  useEffect(() => {
    if (!ownerId) return;
    let active = true;
    let edited = false;
    let dirty = false;
    let current = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(timer);
      if (!dirty) return;
      dirty = false;
      void saveChatDraft(ownerId, roomId, current).catch(() => { dirty = true; });
    };
    session.current = { scope, update(text) {
      edited = dirty = true;
      current = text;
      clearTimeout(timer);
      if (!text) flush();
      else timer = setTimeout(flush, 300);
    } };
    void loadChatDraft(ownerId, roomId).then((text) => {
      if (active && !edited) setValue({ scope, text });
    }).catch(() => {});
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flush();
    });
    return () => {
      active = false;
      flush();
      listener.remove();
      if (session.current?.scope === scope) session.current = null;
    };
  }, [ownerId, roomId, scope]);
  const update = useCallback((text: string) => {
    setValue({ scope, text });
    if (session.current?.scope === scope) session.current.update(text);
  }, [scope]);
  return [value.scope === scope ? value.text : '', update];
}
