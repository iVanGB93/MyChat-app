// One foreground/headless entry. Register wake handlers before mounting the app.
require('./src/services/crashReporting').configureCrashReporting();
require('./src/services/identity/rootBackgroundEntry').registerRootBackgroundHandlers();
const { registerRootComponent } = require('expo');
const LocalAccountApp = require('./src/screens/LocalAccountApp').default;
registerRootComponent(LocalAccountApp);
