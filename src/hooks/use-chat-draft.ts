import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { loadChatDraft, saveChatDraft } from '../modules/storage/chatDrafts';

export function useChatDraft(ownerId: string | null | undefined, roomId: string): [string, (text: string | ((current:string)=>string)) => void] {
  const scope = `${ownerId}:${roomId}`;
  const [value, setValue] = useState({ scope, text: '' });
  const latest=useRef({scope,text:''});
  if(latest.current.scope!==scope)latest.current={scope,text:''};
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
      if (active && !edited) { current = text; latest.current={scope,text}; setValue({ scope, text }); }
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
  const update = useCallback((next: string | ((current:string)=>string)) => {
    if(latest.current.scope!==scope)return; // A completed send from an old screen cannot replace the new draft.
    const text=typeof next==='function'?next(latest.current.text):next;
    latest.current={scope,text};
    setValue({ scope, text });
    if (session.current?.scope === scope) session.current.update(text);
  }, [scope]);
  return [value.scope === scope ? value.text : '', update];
}
