const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const config = getDefaultConfig(__dirname);

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // react-native-webrtc imports 'event-target-shim/index' which isn't listed
  // in the package's exports map (v6.x only exposes '.', './es5', './umd').
  // Metro falls back to file-based resolution but emits a warning.
  // Resolve it directly to the correct index.js to silence the warning.
  if (moduleName === 'event-target-shim/index') {
    const nestedPath = path.resolve(
      __dirname,
      'node_modules/react-native-webrtc/node_modules/event-target-shim/index.js'
    );
    const rootPath = path.resolve(
      __dirname,
      'node_modules/event-target-shim/index.js'
    );
    const filePath = fs.existsSync(nestedPath) ? nestedPath : rootPath;
    return { type: 'sourceFile', filePath };
  }

  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
