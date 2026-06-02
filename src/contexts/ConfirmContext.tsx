/* ------------------------------------------------------------------ */
/*  ConfirmContext — provides a themed Alert.alert replacement.        */
/*                                                                     */
/*  Usage:                                                             */
/*    const confirm = useConfirm();                                    */
/*    confirm({ title: 'Delete', message: '…', icon: 'trash-outline',  */
/*      buttons: [                                                     */
/*        { text: 'Cancel', style: 'cancel' },                         */
/*        { text: 'Delete', style: 'destructive', onPress: () => ... },*/
/*    ]});                                                             */
/*                                                                     */
/*  For drop-in compatibility with `Alert.alert`-style calls we also   */
/*  expose `alert(title, message?)` as a one-button info dialog.       */
/* ------------------------------------------------------------------ */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import ConfirmModal, { ConfirmOptions } from '../components/ui/ConfirmModal';

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => void;
  /** One-button info dialog — drop-in replacement for `Alert.alert(t, m)`. */
  alert: (title: string, message?: string, onPress?: () => void) => void;
}

const ConfirmContext = createContext<ConfirmContextValue | undefined>(undefined);

interface QueuedDialog extends ConfirmOptions {
  /** Internal id so React can key + close the active one. */
  _id: number;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<QueuedDialog | null>(null);
  const [queue, setQueue] = useState<QueuedDialog[]>([]);
  const [seq, setSeq] = useState(0);

  const showNext = useCallback((rest: QueuedDialog[]) => {
    if (rest.length === 0) {
      setActive(null);
      setQueue([]);
      return;
    }
    const [next, ...remaining] = rest;
    setActive(next);
    setQueue(remaining);
  }, []);

  const enqueue = useCallback(
    (dlg: QueuedDialog) => {
      setActive((cur) => {
        if (cur) {
          // Queue behind any currently-visible dialog.
          setQueue((q) => [...q, dlg]);
          return cur;
        }
        return dlg;
      });
    },
    [],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) => {
      const id = seq + 1;
      setSeq(id);
      enqueue({ ...options, _id: id });
    },
    [enqueue, seq],
  );

  const alert = useCallback(
    (title: string, message?: string, onPress?: () => void) => {
      const id = seq + 1;
      setSeq(id);
      enqueue({
        _id: id,
        title,
        message,
        buttons: [{ text: 'OK', style: 'default', onPress }],
      });
    },
    [enqueue, seq],
  );

  const handleClose = useCallback(() => {
    setActive(null);
    // Slight delay so the closing animation finishes before the next
    // dialog slides up — prevents the visual stutter of an instant swap.
    setTimeout(() => {
      setQueue((q) => {
        if (q.length === 0) return q;
        const [next, ...rest] = q;
        setActive(next);
        return rest;
      });
    }, 220);
  }, []);

  const value = useMemo<ConfirmContextValue>(() => ({ confirm, alert }), [confirm, alert]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmModal
        key={active?._id ?? 'idle'}
        visible={!!active}
        onClose={handleClose}
        title={active?.title ?? ''}
        message={active?.message}
        icon={active?.icon}
        buttons={active?.buttons}
        dismissOnBackdrop={active?.dismissOnBackdrop ?? true}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
