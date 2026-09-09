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
  useRef,
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
  const [queue, setQueue] = useState<QueuedDialog[]>([]);
  const active = queue[0] ?? null;
  const seq = useRef(0);

  const enqueue = useCallback(
    (dlg: QueuedDialog) => {
      setQueue((q) => [...q, dlg]);
    },
    [],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) => {
      const id = ++seq.current;
      enqueue({ ...options, _id: id });
    },
    [enqueue],
  );

  const alert = useCallback(
    (title: string, message?: string, onPress?: () => void) => {
      const id = ++seq.current;
      enqueue({
        _id: id,
        title,
        message,
        buttons: [{ text: 'OK', style: 'default', onPress }],
      });
    },
    [enqueue],
  );

  const handleClose = useCallback(() => {
    // ConfirmModal calls this after its closing animation. Remove only that
    // dialog: a repeated close or newly enqueued alert must not skip another.
    setQueue((q) => q[0]?._id === active?._id ? q.slice(1) : q);
  }, [active?._id]);

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
