// Back affordance for screens that live OUTSIDE the native-stack navigator (the add-box / reauth flows
// are AppShell-level routes, so they get neither iOS's native back-swipe nor a hooked-up Android back).
//
// - iOS: swipe-from-the-left-edge to go back - a horizontal right-drag slides the screen and, past a
//   threshold / flick, calls onBack; otherwise it snaps back. Runs on the native UI thread.
// - Android: the SYSTEM back (button / edge gesture) is intercepted to call onBack (go home) instead of
//   exiting the app. We do NOT add an app-level edge pan there - it would fight the system edge gesture.
//
// When there's nowhere to go back to (no onBack), it's a transparent passthrough.

import { useEffect, type ReactNode } from 'react';
import { BackHandler, Platform, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';

export function EdgeSwipeBack({
  onBack,
  children,
}: {
  readonly onBack?: () => void;
  readonly children: ReactNode;
}) {
  const theme = useTheme();
  // Read per render, not once at import. `Dimensions.get('window').width` at module scope is
  // captured when the bundle loads and is stale for the rest of the process after any rotation or
  // resize - and the commit threshold below is a fraction of it. Harmless while this ran only on a
  // portrait-locked iPhone; not something to leave behind now that a foldable or a tablet can change
  // this number under it (see `theme/ContentColumn.tsx`).
  const { width: screenWidth } = useWindowDimensions();
  const tx = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));

  // Android: route the system back (button / gesture) to onBack so it goes home, not out of the app.
  useEffect(() => {
    if (Platform.OS !== 'android' || !onBack) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true; // consumed - don't bubble to "exit app"
    });
    return () => sub.remove();
  }, [onBack]);

  // No back target, or Android (the system back above handles it): plain passthrough.
  if (!onBack || Platform.OS !== 'ios') {
    return <>{children}</>;
  }

  const pan = Gesture.Pan()
    .activeOffsetX(20) // only a rightward horizontal drag activates…
    .failOffsetY([-15, 15]) // …a vertical drag yields to scrolling
    .onUpdate(e => {
      tx.value = Math.max(0, e.translationX);
    })
    .onEnd(e => {
      const committed =
        e.translationX > screenWidth * 0.33 ||
        (e.translationX > 60 && e.velocityX > 600);
      if (committed) {
        tx.value = withTiming(screenWidth, { duration: 160 }, finished => {
          if (finished) {
            runOnJS(onBack)();
          }
        });
      } else {
        tx.value = withTiming(0, { duration: 160 });
      }
    });

  // The app bg sits BEHIND the sliding screen so the reveal during the swipe is the theme background,
  // not the empty (black) window.
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
