const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const config = getDefaultConfig(__dirname);
if (process.env.METRO_USE_WATCHMAN !== '1') {
  config.resolver.useWatchman = false;
}

const projectRoot = __dirname;
const adavenPlatformRoot = path.resolve(projectRoot, '../..');
const originalResolveRequest = config.resolver.resolveRequest;
const webShimPath = path.resolve(projectRoot, 'react-native-web-shim.js');
const rnwCandidates = [
  path.resolve(projectRoot, 'node_modules', 'react-native-web'),
  path.resolve(adavenPlatformRoot, 'node_modules', 'react-native-web'),
];
const rnwRoot = rnwCandidates.find((p) => fs.existsSync(p)) || rnwCandidates[0];

function resolveExistingFile(base) {
  const candidates = [
    base,
    base + '.ts',
    base + '.tsx',
    base + '.js',
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return path.resolve(p);
  }
  return null;
}

function resolveAlias(moduleName) {
  if (moduleName.startsWith('@/')) {
    return resolveExistingFile(path.join(projectRoot, 'src', moduleName.slice(2)));
  }
  if (moduleName === '@adaven/platform-core' || moduleName.startsWith('@adaven/platform-core/')) {
    const sub =
      moduleName === '@adaven/platform-core'
        ? 'index'
        : moduleName.slice('@adaven/platform-core/'.length);
    return resolveExistingFile(path.join(adavenPlatformRoot, 'packages/platform-core/src', sub));
  }
  if (moduleName === '@adaven/platform-ui' || moduleName.startsWith('@adaven/platform-ui/')) {
    const sub =
      moduleName === '@adaven/platform-ui'
        ? 'index'
        : moduleName.slice('@adaven/platform-ui/'.length);
    return resolveExistingFile(path.join(adavenPlatformRoot, 'packages/platform-ui/src', sub));
  }
  return null;
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && (moduleName === 'react-native' || moduleName === 'react-native-web')) {
    return { type: 'sourceFile', filePath: webShimPath };
  }
  if (moduleName.startsWith('react-native-web/dist/exports/')) {
    const sub = moduleName.slice('react-native-web/dist/exports/'.length);
    const base = path.join(rnwRoot, 'src', 'exports', sub);
    for (const p of [path.join(base, 'index.js'), base + '.js', base]) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        return { type: 'sourceFile', filePath: path.resolve(p) };
      }
    }
  }
  const aliasPath = resolveAlias(moduleName);
  if (aliasPath) return { type: 'sourceFile', filePath: aliasPath };
  if (originalResolveRequest) return originalResolveRequest(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

config.watchFolders = [...(config.watchFolders || []), adavenPlatformRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(adavenPlatformRoot, 'node_modules'),
];

module.exports = config;
