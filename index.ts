// Notifee REQUIRES the background event handler to be registered at the
// module top-level of the entry file so it can fire when the app is killed
// or backgrounded (e.g. when the user taps Accept / Decline on the call
// notification from the lock screen).
import { registerCallNotificationBackgroundHandler } from './src/services/callNotificationService';
registerCallNotificationBackgroundHandler();

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
