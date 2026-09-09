import { useCallback, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { loadContactNicknames, resolveContactName, useNicknameStore } from '../services/contact-nicknames';
const empty = {};

export function useContactName() {
  const ownerId = useAppStore((state) => state.user?.id);
  const names = useNicknameStore((state) => ownerId ? state.byOwner[ownerId] ?? empty : empty);
  useEffect(() => { if (ownerId) void loadContactNicknames(ownerId).catch(() => {}); }, [ownerId]);
  return useCallback((id: number | undefined, fallback: string, username?: string) =>
    resolveContactName(names, id, fallback, username), [names]);
}
