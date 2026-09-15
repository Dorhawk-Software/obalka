// Reading a code off the other phone's screen (025, and 006 T012b rides on it).
//
// The camera is the app's first, and it is asked for ONE thing: pointing at another phone across a
// table. Nothing here takes a photograph, nothing is written to disk, and the preview is live only
// while this component is mounted. What leaves it is a string that `parseTransferQr` has already
// decided is one of ours — a code that is not is dropped without the caller ever seeing it, because
// a camera pointed at a table sees timetables, Wi-Fi codes and payment QRs, and PAKE gives exactly
// one guess per attempt.
//
// The PARSER IS PASSED IN, so the same viewfinder reads a transfer phrase and a recovery key without
// either knowing about the other. That matters beyond tidiness: the two codes carry different
// prefixes precisely so one cannot be mistaken for the other, and a scanner hard-wired to one of
// them would have had to grow a mode flag to serve both - which is the shape that eventually accepts
// the wrong one.
//
// The IMPORT IS DYNAMIC, and that is the whole reason this file exists separately. Loading
// `react-native-vision-camera` at module scope would make the transfer screen - and everything that
// imports it - fail on a build without the native camera, which is the failure mode `bulkCipher.ts`
// and `nativeTransport.ts` both avoid. Here, a missing camera means the scan button is not offered.

import { useEffect, useState } from 'react';
import { XStack, YStack } from '../../../theme/ui';
import { Body, BodyStrong } from '../../../theme/Typography';
import { PressScale } from '../../../theme/PressScale';
import { useTheme } from '../../../theme/ThemeProvider';
import { CloseIcon } from '../../../theme/icons';
import { t } from '../../../i18n/strings';
import { parseTransferQr } from '../../../services/transfer/transferQr';
import { reportFailure } from '../../../services/telemetry/telemetry';

/** Resolved per call, never at import - see the file header. */
function cameraModules(): {
  useCameraPermission: () => {
    hasPermission: boolean;
    requestPermission: () => Promise<boolean>;
  };
  useCameraDevice: (position: string) => unknown;
  CodeScanner: React.ComponentType<Record<string, unknown>>;
} | null {
  try {
    const camera = require('react-native-vision-camera');
    const scanner = require('react-native-vision-camera-barcode-scanner');
    if (
      !camera?.useCameraPermission ||
      !camera?.useCameraDevice ||
      !scanner?.CodeScanner
    ) {
      return null;
    }
    return {
      useCameraPermission: camera.useCameraPermission,
      useCameraDevice: camera.useCameraDevice,
      CodeScanner: scanner.CodeScanner,
    };
  } catch (e) {
    reportFailure('transfer.native', e, { stage: 'native' });
    return null;
  }
}

/** Whether this build can scan at all. The button is hidden when it cannot. */
export function scanningAvailable(): boolean {
  return cameraModules() != null;
}

/**
 * The scanner, as a full-screen overlay.
 *
 * `onFound` fires at most once: the first code that parses as one of ours wins, and the camera stops
 * immediately. A scanner that kept firing would hand the caller a second phrase while it was already
 * acting on the first.
 */
export function TransferCodeScanner({
  onFound,
  onCancel,
  parse = parseTransferQr,
  hint,
}: {
  readonly onFound: (value: string) => void;
  readonly onCancel: () => void;
  /** Decides whether a scanned code is one of ours. Defaults to the transfer phrase. */
  readonly parse?: (scanned: string) => string | null;
  /** What to aim at, in the caller's own words. */
  readonly hint?: string;
}) {
  const theme = useTheme();
  const modules = cameraModules();
  const [done, setDone] = useState(false);
  const [denied, setDenied] = useState(false);

  // Hooks must not be called conditionally, and `modules` is null only on a build where this
  // component is never rendered - `scanningAvailable` gates it at the call site.
  const permission = modules?.useCameraPermission() ?? {
    hasPermission: false,
    requestPermission: async () => false,
  };
  const { hasPermission, requestPermission } = permission;
  // The library's own CodeScanner THROWS "No Camera device available!" from inside render when there
  // is no back camera - which on a device without one, or an emulator, is a red box instead of a
  // screen. Asking first turns that into the same graceful answer a declined permission gets.
  const device = modules?.useCameraDevice('back') ?? null;

  useEffect(() => {
    if (hasPermission || denied) {
      return;
    }
    let alive = true;
    void requestPermission().then(granted => {
      if (alive && !granted) {
        // Declining is a decision, not a fault. The screen says what is now unavailable and leaves
        // typing - which has always worked - as the way through.
        setDenied(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [hasPermission, denied, requestPermission]);

  if (!modules) {
    return null;
  }
  const { CodeScanner } = modules;

  const frame = (children: React.ReactNode) => (
    <YStack
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      // The opaque scrim rather than a hand-written black: a viewfinder wants the darkest ground the
      // palette has, and the palette is where colours come from (constitution V). `scrimOpaque` is
      // also the one the design already uses when a backdrop must not be translucent.
      backgroundColor={theme.scrimOpaque}
      testID="transfer-scanner"
    >
      {children}
      <YStack position="absolute" bottom={0} left={0} right={0} padding={20} gap={12}>
        <Body fontSize={13} color={theme.surfaceAlt} textAlign="center">
          {hint ?? t('transfer.scan.hint')}
        </Body>
        <PressScale
          fullWidth
          onPress={onCancel}
          accessibilityLabel={t('common.cancel')}
          testID="transfer-scanner-close"
        >
          <XStack
            width="100%"
            minHeight={48}
            borderRadius={14}
            backgroundColor={theme.surface}
            alignItems="center"
            justifyContent="center"
            gap={8}
          >
            <CloseIcon size={16} color={theme.text} />
            <BodyStrong fontSize={15} color={theme.text}>
              {t('common.cancel')}
            </BodyStrong>
          </XStack>
        </PressScale>
      </YStack>
    </YStack>
  );

  if (denied || !hasPermission || !device) {
    return frame(
      <YStack flex={1} alignItems="center" justifyContent="center" padding={24}>
        <Body fontSize={14} color={theme.surfaceAlt} textAlign="center">
          {device ? t('transfer.scan.denied') : t('transfer.scan.noCamera')}
        </Body>
      </YStack>,
    );
  }

  return frame(
    <CodeScanner
      style={{ flex: 1 }}
      isActive={!done}
      // 'qr-code', not 'qr'. The native factory rejects an unknown format and the screen comes up as
      // a render error rather than a camera - and the type that would have caught it is behind a
      // dynamic require, so nothing checked this until a device did.
      barcodeFormats={['qr-code']}
      onBarcodeScanned={(codes: { value?: string }[]) => {
        if (done) {
          return;
        }
        for (const code of codes) {
          const phrase = code.value ? parse(code.value) : null;
          if (phrase) {
            // First match wins and the camera stops. Everything else in view is somebody's bus
            // timetable and is dropped without the caller ever hearing about it.
            setDone(true);
            onFound(phrase);
            return;
          }
        }
      }}
      onError={(e: unknown) => {
        reportFailure('transfer.native', e, { stage: 'native' });
        setDenied(true);
      }}
    />,
  );
}
