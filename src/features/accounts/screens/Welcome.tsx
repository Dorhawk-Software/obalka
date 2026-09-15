// First-run welcome (feature 009). The branded entry point shown when there are no boxes yet: the
// "Obálka" brand lockup (logo tile + Bricolage wordmark + a one-line tagline) and a single dark
// primary action that enters the existing add-box flow. Mounted by AppShell when `accounts.length === 0`
// (see the 'welcome' route); tapping the button routes to 'addBox' (LoginFlow → AddBoxForm).
//
// NOTE: the design also draws an "Obnovit ze zálohy" (restore-from-backup) text button below the CTA -
// deliberately NOT shipped here. Backup/restore is feature 006 and isn't built; a dead button would
// mislead the user.

import { XStack, YStack } from '../../../theme/ui';
import { Body, BodyStrong, Display, Label } from '../../../theme/Typography';
import { PressScale } from '../../../theme/PressScale';
import { useTheme } from '../../../theme/ThemeProvider';
import { HelpIcon } from '../../../theme/icons';
import { fonts } from '../../../theme/typography';
import { textSlop } from '../../../theme/touchTarget';
import { t } from '../../../i18n/strings';
import LogoMark from '../../../assets/logo.svg';
import { DebugRecordingFrame } from '../../../app/DebugRecordingStrip';

/** The help link's vertical padding - read by its touch slop too, so the two cannot drift apart. */
const FAQ_PAD = 6;

interface WelcomeProps {
  readonly onAddBox: () => void;
  readonly onOpenFaq: () => void;
}

export function Welcome(props: WelcomeProps) {
  // Removing the last box while Debug mode records lands here, still recording (023 FR-007). The shell
  // draws this outside the navigator, so the strip is a mark: the Debug screen is not reachable from it.
  return (
    <DebugRecordingFrame>
      <WelcomeContent {...props} />
    </DebugRecordingFrame>
  );
}

function WelcomeContent({ onAddBox, onOpenFaq }: WelcomeProps) {
  const theme = useTheme();
  return (
    <YStack flex={1} backgroundColor={theme.bg} testID="welcome">
      {/* ONE centered column (design: padding 36/32, everything - logo, wordmark, tagline AND the
          primary action - is a centered child; the button is NOT pinned to the bottom). Our logo.svg
          is already a rounded-square app-icon badge (blue body + gold flap), so it's shown on its own
          - NOT inside another blue tile (that made the blue body read blue-on-blue). */}
      <YStack
        flex={1}
        alignItems="center"
        justifyContent="center"
        paddingVertical={36}
        paddingHorizontal={32}
      >
        {/* Bare badge (no tile) with the design's soft brand-blue drop shadow. */}
        <YStack
          width={120}
          height={120}
          borderRadius={26}
          marginBottom={34}
          style={{ boxShadow: '0 18px 42px rgba(33,50,90,0.35)' }}
        >
          <LogoMark width={120} height={120} />
        </YStack>
        <Display
          fontSize={34}
          lineHeight={41}
          letterSpacing={-1}
          color={theme.text}
          textAlign="center"
        >
          {t('app.name')}
        </Display>
        {/* Public Sans is a per-face family: the Medium face has to be named explicitly (a fontWeight
            override alone can't reach it). */}
        <Body
          fontSize={16}
          lineHeight={23}
          fontFamily={fonts.bodyMedium}
          fontWeight="500"
          color={theme.textMuted}
          textAlign="center"
          maxWidth={280}
          marginTop={12}
        >
          {t('welcome.tagline')}
        </Body>

        {/* Single dark, high-contrast primary action → enters the add-box flow (design: 54dp tall,
            radius 16, `text` fill / `surfaceAlt` label, capped at 300dp, one soft warm-ink shadow). */}
        <PressScale
          fullWidth
          onPress={onAddBox}
          accessibilityLabel={t('login.title')}
          testID="welcome-add-box"
          style={{ maxWidth: 300, marginTop: 40 }}
        >
          <XStack
            width="100%"
            minHeight={54}
            borderRadius={16}
            backgroundColor={theme.text}
            alignItems="center"
            justifyContent="center"
            style={{ boxShadow: '0 6px 16px rgba(33,27,18,0.25)' }}
          >
            <BodyStrong fontSize={16} color={theme.surfaceAlt}>{t('login.title')}</BodyStrong>
          </XStack>
        </PressScale>
      </YStack>

      {/* Help, pinned to the bottom and deliberately quiet (design): it must not compete with the
          single primary action, but it has to be findable by someone who cannot get past this screen
          because they do not know where ISDS credentials come from. */}
      <XStack
        position="absolute"
        left={0}
        right={0}
        bottom={24}
        alignItems="center"
        justifyContent="center"
        gap={6}
        paddingVertical={FAQ_PAD}
        // The line is the dense 14pt label (its box matches the 16pt icon beside it) plus this
        // padding - a text button, so its height comes from the type scale, not from a number.
        hitSlop={textSlop('label', { fontSize: 14, dense: true, paddingVertical: FAQ_PAD })}
        onPress={onOpenFaq}
        pressStyle={{ opacity: 0.5 }}
        accessibilityRole="button"
        testID="welcome-faq"
      >
        <HelpIcon size={16} color={theme.textMuted} />
        <Label fontSize={14} dense color={theme.textMuted}>
          {t('faq.help')}
        </Label>
      </XStack>
    </YStack>
  );
}
