import {useSyncExternalStore} from 'react';
import {subscribeLanguage,languageSnapshot} from './language';
/** Invalidate memoized presentation without remounting screens or losing drafts. */
export function useLanguage(){return useSyncExternalStore(subscribeLanguage,languageSnapshot,languageSnapshot);}
