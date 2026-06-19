// Notifee REQUIRES the background event handler to be registered at the
// module top-level of the entry file so it can fire when the app is killed
// or backgrounded (e.g. when the user taps Accept / Decline on the call
// notification, or types a direct Reply on a message notification).
// Notifee allows only ONE background handler, so calls + message replies are
// funnelled through a single unified dispatcher.
import { registerNotificationBackgroundHandler } from './src/services/notificationBackgroundDispatcher';
registerNotificationBackgroundHandler();

// FCM data-message background handler — also MUST be registered at the module
// top-level so it fires when the app is fully killed: it persists the incoming
// message to SQLite, sends the delivery ack, and renders the MessagingStyle
// notification.
import { registerFcmBackgroundHandler } from './src/services/fcmService';
registerFcmBackgroundHandler();

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
