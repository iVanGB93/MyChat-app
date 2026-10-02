// Opt-in until local chat, recovery discovery, and existing-account migration are ready.
// Conditional requires keep legacy auth and background delivery initialization out of this flow.
if (process.env.EXPO_PUBLIC_AXONIC_LOCAL_ACCOUNT === '1') {
  const { registerRootComponent } = require('expo');
  const LocalAccountApp = require('./src/screens/LocalAccountApp').default;
  registerRootComponent(LocalAccountApp);
} else {
  require('./legacyEntry');
}
