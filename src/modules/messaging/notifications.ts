/** OS/UI notification adapter for the same local inbox and delivery queue. */
export {handleRootNotificationAction} from '../../services/identity/rootNotificationActions';
export {setRootVisibleConversation,queueRootNotificationOpen,pendingRootNotificationOpen,finishRootNotificationOpen} from '../../services/identity/rootNotificationRoute';
export {subscribeRootMessageToast,type RootToast} from '../../services/identity/rootMessageToast';
export {defaultRootNotificationPreferences,readRootNotificationPreferences,saveRootNotificationPreferences,type RootNotificationPreferences} from '../../services/identity/rootNotificationPreferences';
