const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const { withSentryConfig } = require('@sentry/react-native/metro');

const defaultConfig = getDefaultConfig(__dirname);
const { assetExts, sourceExts } = defaultConfig.resolver;

/**
 * Metro configuration. SVGs are imported as React components via react-native-svg-transformer.
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  transformer: {
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
  },
  resolver: {
    assetExts: assetExts.filter(ext => ext !== 'svg'),
    sourceExts: [...sourceExts, 'svg'],
  },
};

// `withSentryConfig` adds the source-map upload hook to the bundler, which is what turns a release
// stack trace from `index.android.bundle:1:284729` into a file and a line. Applied ONCE, and keep
// it that way: `npx @sentry/wizard` is NOT idempotent. It has been run three times here (a US org,
// then the EU one, then the Dorhawk org) and every single time it appended another import of this
// binding and wrapped the export in another call. Two `const`s of the same name at module scope is
// a SyntaxError, so Metro does not start at all - the failure is loud, but only once you try to
// bundle. If you rerun the wizard, check this file before anything else.
module.exports = withSentryConfig(mergeConfig(defaultConfig, config));
