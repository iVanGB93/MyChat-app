module.exports = ({ config }) => ({
  ...config,
  extra: {...config.extra, diagnosticsJsSourceSha256: require('./scripts/diagnostic-source-hash.cjs')(__dirname)},
  plugins: [
    ...(config.plugins || []),
    ['@sentry/react-native/expo', {
      organization: process.env.SENTRY_ORG || 'qbared',
      project: process.env.SENTRY_PROJECT || 'axonic-mobile',
      useNativeInit: false,
      experimental_android: {
        enableAndroidGradlePlugin: true,
        includeProguardMapping: true,
        autoUploadProguardMapping: true,
        uploadNativeSymbols: true,
        autoUploadNativeSymbols: true,
        includeNativeSources: false,
        includeSourceContext: false,
      },
    }],
  ],
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './plugins/android/google-services.json',
  },
});
