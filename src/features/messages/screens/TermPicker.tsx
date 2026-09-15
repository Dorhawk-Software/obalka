// The "Termín" picker (feature 010 US2): a bottom sheet for putting a date on a message.
//
// Reuses the BoxSwitcherSheet scaffolding exactly - warm scrim, surfaceAlt sheet, grab handle,
// swipe-down to dismiss, Android back closes it, and it closes when the app backgrounds so nothing is
// left sitting over the lock screen. No new sheet metrics: sheet radius 24, padding 10/14/18, the
// same handle. Reusing beats inventing (Principle V - the metrics come from the scale, not from this
// screen's taste).
//
// Presets are relative to TODAY, not to the message. "Za týden" means a week from now, because the
// user is deciding when THEY want to look at this again.

import { useCallback, useState } from 'react';
import { Modal, Pressable } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  SlideInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sheetWidth } from '../../../theme/ContentColumn';
import { Body, BodyStrong, Caption, Heading } from '../../../theme/Typography';
import { Button, XStack, YStack } from '../../../theme/ui';
import { useTheme } from '../../../theme/ThemeProvider';
import { useScrim } from '../../../theme/useScrim';
import { touchSlop } from '../../../theme/touchTarget';
import { depth } from '../../../theme/depth';
import { chipTone } from '../../../theme/chipTone';
import { CheckIcon } from '../../../theme/icons';
import { useCloseOnBackground } from '../../../app/useCloseOnBackground';
import { haptics } from '../../../services/haptics';
import { t } from '../../../i18n/strings';
import { reminderPromise } from '../state/reminders';

/** Midnight local on the day `d` days from `from` - the shape a stored reminder date takes. */
function dayFromNow(from: number, days: number): number {
  const d = new Date(from);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

/** Midnight local on the last day of `from`'s month. */
function endOfMonth(from: number): number {
  const d = new Date(from);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime();
}

interface Preset {
  key: string;
  labelKey: string;
  at: (now: number) => number;
}

const PRESETS: Preset[] = [
  { key: 'week', labelKey: 'term.preset.week', at: n => dayFromNow(n, 7) },
  { key: 'twoWeeks', labelKey: 'term.preset.twoWeeks', at: n => dayFromNow(n, 14) },
  { key: 'endOfMonth', labelKey: 'term.preset.endOfMonth', at: endOfMonth },
];

/**
 * "22. 8." - the compact Czech form the chips use.
 *
 * The separator is a NON-BREAKING space (U+00A0). With an ordinary one, "11. 9." is two breakable
 * tokens, and in the password-expiry strip at a large text size the day and the month wrapped onto
 * different lines with the action button between them. A date is one thing and must break as one.
 */
export function formatTermDate(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getDate()}.\u00A0${d.getMonth() + 1}.`;
}

/** The day-stepper buttons' drawn width - declared so the touch slop is derived, not guessed. */
const STEPPER_W = 38;

const sameDay = (a: number, b: number) =>
  new Date(a).toDateString() === new Date(b).toDateString();

export function TermPicker({
  current,
  onPick,
  onRemove,
  onClose,
  now = Date.now(),
}: {
  /** The reminder already on this message, or null. Opens with it preselected. */
  readonly current: number | null;
  readonly onPick: (date: number) => void;
  readonly onRemove: () => void;
  readonly onClose: () => void;
  readonly now?: number;
}) {
  const theme = useTheme();
  const scrim = useScrim(0.4);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const blue = chipTone('userBlue', theme);
  const [custom, setCustom] = useState<number | null>(null);

  useCloseOnBackground(useCallback(() => onClose(), [onClose]));

  const sheetShadow =
    theme.name === 'dark'
      ? 'inset 0px 1px 1px rgba(255,255,255,0.06), 0px -2px 18px rgba(0,0,0,0.45)'
      : depth.lg;

  const dragY = useSharedValue(0);
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));
  const sheetPan = Gesture.Pan()
    .activeOffsetY(12)
    .onUpdate(e => {
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd(e => {
      if (e.translationY > 90 || e.velocityY > 800) {
        dragY.value = withTiming(600, { duration: 180 }, finished => {
          if (finished) {
            runOnJS(onClose)();
          }
        });
      } else {
        dragY.value = withTiming(0, { duration: 160 });
      }
    });

  const selected = custom ?? current;
  const pick = (date: number) => {
    haptics.selection();
    onPick(date);
    onClose();
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* No `accessibilityLabel`: `accessible={false}` means it is never announced. */}
      <Pressable
        accessible={false}
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: scrim,
          justifyContent: 'flex-end',
          alignItems: 'center',
        }}
      >
        <GestureDetector gesture={sheetPan}>
          <Animated.View
            style={[sheetStyle, sheetWidth]}
            entering={reduceMotion ? undefined : SlideInDown.duration(240)}
          >
            {/* Not an accessibility element: on iOS this wrapper would swallow every control
                inside the sheet into one unreachable blob (see theme/Dialog.tsx). */}
            <Pressable accessible={false} onPress={() => {}}>
              <YStack
                // Keeps the VoiceOver cursor inside the picker rather than letting it wander the
                // message behind it, as in theme/Dialog.tsx. Android needs no prop: the `Modal` is a
                // dialog window of its own, and TalkBack stays inside it.
                accessibilityViewIsModal
                backgroundColor={theme.surfaceAlt}
                borderTopLeftRadius={24}
                borderTopRightRadius={24}
                paddingTop={10}
                paddingHorizontal={14}
                paddingBottom={insets.bottom + 18}
                style={{ boxShadow: sheetShadow }}
              >
                <YStack
                  alignSelf="center"
                  width={40}
                  height={4}
                  borderRadius={999}
                  backgroundColor={theme.borderStrong}
                  marginTop={6}
                  marginBottom={14}
                />
                <YStack paddingHorizontal={6} paddingBottom={4}>
                  <Heading fontSize={16}>{t('term.title')}</Heading>
                  {/* Says whose date this is. The app does not compute legal deadlines, and the
                      picker must not be read as if it did (Principle VI). */}
                  <Caption
                    fontSize={12}
                    lineHeight={16}
                    marginTop={2}
                    color={theme.textFaint}
                  >
                    {/* What this date will ACTUALLY get. A deadline chosen for today after 09:00
                        gets no notification at all, and the sheet used to promise two. */}
                    {t(
                      {
                        both: 'term.sub',
                        onDay: 'term.sub.onDay',
                        none: 'term.sub.none',
                      }[reminderPromise(selected, now)],
                    )}
                  </Caption>
                </YStack>

                <YStack
                  borderWidth={1}
                  borderColor={theme.border}
                  borderRadius={14}
                  backgroundColor={theme.surface}
                  overflow="hidden"
                  marginTop={12}
                >
                  {PRESETS.map((p, i) => {
                    const date = p.at(now);
                    const isSelected = selected != null && sameDay(selected, date);
                    return (
                      <XStack
                        key={p.key}
                        alignItems="center"
                        gap={12}
                        paddingVertical={13}
                        paddingHorizontal={14}
                        borderBottomWidth={i === PRESETS.length - 1 ? 0 : 1}
                        borderBottomColor={theme.border}
                        pressStyle={{ opacity: 0.7 }}
                        onPress={() => pick(date)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        accessibilityLabel={`${t(p.labelKey)}, ${formatTermDate(date)}`}
                        testID={`term-${p.key}`}
                      >
                        <YStack flex={1}>
                          <BodyStrong fontSize={15} color={theme.text}>
                            {t(p.labelKey)}
                          </BodyStrong>
                        </YStack>
                        <Body fontSize={13} color={theme.textFaint}>
                          {formatTermDate(date)}
                        </Body>
                        {/* Reserved so selecting does not shift the row (Principle V). */}
                        <YStack width={18} alignItems="center">
                          {isSelected ? (
                            <CheckIcon size={18} color={blue.fg} />
                          ) : null}
                        </YStack>
                      </XStack>
                    );
                  })}
                </YStack>

                {/* Custom day-stepper. A full calendar is a native picker per platform; the design
                    never specified one, so this ships the honest minimum - nudge a day at a time from
                    the current selection - rather than inventing a calendar. */}
                <XStack
                  alignItems="center"
                  gap={12}
                  marginTop={12}
                  paddingVertical={11}
                  paddingHorizontal={14}
                  borderWidth={1}
                  borderColor={theme.border}
                  borderRadius={14}
                  backgroundColor={theme.surface}
                >
                  <YStack flex={1}>
                    <BodyStrong fontSize={15} color={theme.text}>
                      {t('term.custom')}
                    </BodyStrong>
                    <Caption fontSize={12} marginTop={2} color={theme.textFaint}>
                      {formatTermDate(selected ?? dayFromNow(now, 1))}
                    </Caption>
                  </YStack>
                  <Button
                    minHeight={36}
                    minWidth={STEPPER_W}
                    paddingHorizontal={14}
                    borderRadius={11}
                    backgroundColor={theme.surfaceSunken}
                    color={theme.text}
                    fontSize={16}
                    fontWeight="700"
                    // A 36×38 nudge button is under the target on both axes. The row's gap is 12, so
                    // 5 each side keeps the two buttons' areas from touching.
                    hitSlop={touchSlop({ width: STEPPER_W, height: 36 })}
                    onPress={() => {
                      const base = selected ?? dayFromNow(now, 1);
                      const next = dayFromNow(base, -1);
                      if (next > now) {
                        haptics.selection();
                        setCustom(next);
                      }
                    }}
                    accessibilityLabel={t('term.custom.earlier')}
                    testID="term-earlier"
                  >
                    −
                  </Button>
                  <Button
                    minHeight={36}
                    minWidth={STEPPER_W}
                    paddingHorizontal={14}
                    borderRadius={11}
                    backgroundColor={theme.surfaceSunken}
                    color={theme.text}
                    fontSize={16}
                    fontWeight="700"
                    hitSlop={touchSlop({ width: STEPPER_W, height: 36 })}
                    onPress={() => {
                      haptics.selection();
                      setCustom(dayFromNow(selected ?? dayFromNow(now, 1), 1));
                    }}
                    accessibilityLabel={t('term.custom.later')}
                    testID="term-later"
                  >
                    +
                  </Button>
                </XStack>

                <XStack gap={10} marginTop={14}>
                  {current != null ? (
                    <Button
                      flex={1}
                      minHeight={46}
                      borderRadius={14}
                      backgroundColor={theme.surfaceSunken}
                      color={theme.text}
                      fontSize={15}
                      fontWeight="700"
                      onPress={() => {
                        haptics.selection();
                        onRemove();
                        onClose();
                      }}
                      accessibilityLabel={t('term.remove')}
                      testID="term-remove"
                    >
                      {t('term.remove')}
                    </Button>
                  ) : null}
                  <Button
                    flex={1}
                    minHeight={46}
                    borderRadius={14}
                    backgroundColor={theme.text}
                    color={theme.surfaceAlt}
                    fontSize={15}
                    fontWeight="700"
                    onPress={() => pick(selected ?? dayFromNow(now, 1))}
                    accessibilityLabel={t('term.save')}
                    testID="term-save"
                  >
                    {t('term.save')}
                  </Button>
                </XStack>
              </YStack>
            </Pressable>
          </Animated.View>
        </GestureDetector>
      </Pressable>
    </Modal>
  );
}
