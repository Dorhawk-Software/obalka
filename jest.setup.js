/* eslint-env jest, node */
// Use the library's official mock for react-native-safe-area-context so any screen that reads
// useSafeAreaInsets / renders SafeAreaProvider works under jest without each suite wrapping a real
// provider (returns zero insets + passthrough components). Needed since the shell-level TestEnvBanner
// (and others) read the safe-area inset.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// Reanimated + gesture-handler are native (their real gesture/animation is verified on-device, not in
// jest). Mock just what SwipeableRow uses so screens that embed it render in tests: `useReducedMotion`
// (toggle it in a test to exercise the reduce-motion fallback) and a ReanimatedSwipeable that simply
// renders the row plus its trailing actions inline (so the action's label/testID is assertable).
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    default: {
      View: RN.View,
      ScrollView: RN.ScrollView,
      createAnimatedComponent: c => c,
    },
    useReducedMotion: jest.fn(() => false),
    useSharedValue: v => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withTiming: v => v,
    withSpring: v => v,
    withRepeat: v => v,
    cancelAnimation: () => {},
    Easing: { inOut: fn => fn, ease: v => v },
    runOnJS: fn => fn,
    SlideInDown: { duration: () => ({}) },
    interpolate: () => 0,
    Extrapolation: { CLAMP: 'clamp' },
  };
});

jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ children, renderRightActions, testID }) =>
      React.createElement(
        View,
        { testID },
        children,
        renderRightActions ? renderRightActions() : null,
      ),
  };
});

// App.tsx wraps the tree in GestureHandlerRootView (from the main module); stub it to a plain View so
// the app renders in jest without the native gesture-handler module.
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View, Pressable } = require('react-native');
  // A chainable no-op gesture (Gesture.Pan().activeOffsetX(20).onEnd(fn)… all return the same stub).
  const gestureStub = () => {
    const g = new Proxy({}, { get: () => () => g });
    return g;
  };
  return {
    __esModule: true,
    GestureHandlerRootView: ({ children, style }) =>
      React.createElement(View, { style }, children),
    // gesture-handler's Pressable behaves like RN's in tests (onPress / a11y / pressed-style callback).
    Pressable,
    GestureDetector: ({ children }) => children,
    Gesture: { Pan: gestureStub, Tap: gestureStub },
  };
});

// react-native-haptic-feedback: no native module in jest — mock its trigger so the haptics wrapper is
// recordable (the semantic wiring is unit-tested; the physical feel is validated on-device).
jest.mock('react-native-haptic-feedback', () => ({
  __esModule: true,
  default: { trigger: jest.fn() },
}));
// The wrapper guards on native-module availability (so an un-rebuilt bundle never crashes); make that
// check pass under jest so the wrapper actually invokes the mocked trigger.
try {
  require('react-native').NativeModules.RNHapticFeedback = {};
} catch (e) {
  /* RN preset not ready — the wrapper just stays a no-op, which is also safe */
}


// @sentry/react-native has no native module under jest, and its ESM entry is outside the transform
// allow-list. Mocked here rather than added to `transformIgnorePatterns` because nothing in a unit
// test should reach a real SDK that opens sockets and installs crash handlers.
//
// The mock is deliberately a set of `jest.fn()`s rather than no-ops: `telemetry.test.ts` asserts on
// what would have been sent — including the property that matters most, that nothing is sent when
// consent is off.
jest.mock('@sentry/react-native', () => ({
  __esModule: true,
  init: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
  startSpan: jest.fn((_opts, fn) => fn({ setAttributes: jest.fn() })),
  setUser: jest.fn(),
  setTags: jest.fn(),
  close: jest.fn(),
  // `App.tsx` exports `Sentry.wrap(App)` - kept from the wizard because it measures app start and
  // time-to-initial-display. A passthrough here: the real one is inert until `Sentry.init` has run,
  // which under jest it never does (no DSN), so the identity function IS its behaviour in tests.
  wrap: jest.fn(component => component),
  // Named so `telemetryTransport.test.ts` can assert that the DEFAULT tracing integration is being
  // replaced — the override is what stops every ISDS request becoming an http.client span.
  reactNativeTracingIntegration: jest.fn(options => ({
    name: 'ReactNativeTracing',
    options,
  })),
}));
