// App settings (theme mode + language), loaded from and persisted to the encrypted DB's app_settings
// table. The chosen language is applied to the i18n module synchronously (so t() is correct) and the
// app subtree is keyed by locale upstream, so changing language re-localizes everything. Theme mode
// resolves to light/dark in App (system → OS scheme) and flows through the ThemeProvider reactively.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { settingsStore } from '../../features/accounts/deps';
import { setActiveLocale, type Locale } from '../../i18n/strings';
import { APP_LOCK_KEY, SCAN_ATTACHMENTS_KEY, TELEMETRY_KEY } from './settingsKeys';
import { reportFailure, setTelemetryEnabled } from '../../services/telemetry/telemetry';

/** Default UI language. Czech-first - the app's audience is primarily Czech; non-Czech users can
 *  switch on the first-run add-box screen or in Settings, and the choice is then persisted. */
const DEFAULT_LOCALE: Locale = 'cs';

export type ThemeMode = 'light' | 'dark' | 'system';

interface SettingsValue {
  themeMode: ThemeMode;
  locale: Locale;
  /** Whether the biometric app-lock is enabled (the lock itself lives in `AppLock`/Keychain). */
  appLock: boolean;
  /**
   * Whether downloaded attachments may be scanned on-device for a deadline (010 US3).
   *
   * Defaults to FALSE and stays false until the user asks. The scan reads the contents of legal
   * mail, and Principle III's answer to that is opt-in: with this off, no document text is processed
   * at all - the parser is not even loaded.
   */
  scanAttachments: boolean;
  /**
   * Whether a failure may be reported off the device (see `services/telemetry`).
   *
   * Distinct from `scanAttachments` in what it protects: that one gates whether the app READS a
   * document at all, this one gates whether a technical description of a failure LEAVES. Reports
   * carry no message content, no names and no box IDs - `telemetry/scrub.ts` is what makes that
   * true - but "carries nothing of yours" is still not the same as "you were asked".
   *
   * THREE STATES, and the third is the point. `null` means the user has not been asked yet, which
   * is not the same as having said no: nothing transmits, and the app owes them the question. It
   * separates "declined" from "never offered", which a boolean cannot, and it is what lets the
   * first-run card appear exactly once and never again.
   */
  telemetry: boolean | null;
  /** False until the persisted settings have been loaded (avoids a theme/language flash on launch). */
  ready: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setLocale: (locale: Locale) => void;
  /**
   * Mirror the app-lock toggle. Moving the vault key and persisting the switch is the vault's job
   * (`AppLock.enable` / `disable` / `forget`); this keeps the UI in step and writes the same value.
   */
  setAppLock: (enabled: boolean) => void;
  setScanAttachments: (enabled: boolean) => void;
  setTelemetry: (enabled: boolean) => void;
}

const THEME_KEY = 'themeMode';
const LOCALE_KEY = 'locale';
const SCAN_KEY = SCAN_ATTACHMENTS_KEY;

/**
 * Diagnostics start UNANSWERED, and nothing transmits until the user has answered.
 *
 * This was `true` - on by default - while the only person running the app was the person who needed
 * the reports. It stopped being defensible the moment the app pointed at a real project, for a
 * reason that is not GDPR: ePrivacy (in Czech law § 89 zák. 127/2005 Sb.) governs storing or
 * reading information on someone's device REGARDLESS of whether it is personal data, and requires
 * prior consent unless the access is strictly necessary to deliver the service asked for. The
 * Sentry SDK writes a persistent per-install id to the device; crash analytics is not strictly
 * necessary to deliver a mail client. Legitimate interest does not answer that rule, because it is
 * not a GDPR question.
 *
 * There is a plainer argument too. This app tells users that scanned text "neopouští telefon" and
 * that attachments are "nikam neodesíláme". Transmitting by default without asking would hand a
 * complainant the case in the app's own words.
 */
const TELEMETRY_DEFAULT = null;

const SettingsContext = createContext<SettingsValue | null>(null);

// Safe defaults when no provider is mounted (e.g. a screen rendered in isolation in a test).
const DEFAULTS: SettingsValue = {
  themeMode: 'system',
  locale: DEFAULT_LOCALE,
  appLock: false,
  scanAttachments: false,
  telemetry: TELEMETRY_DEFAULT,
  ready: true,
  setThemeMode: () => {},
  setLocale: () => {},
  setAppLock: () => {},
  setScanAttachments: () => {},
  setTelemetry: () => {},
};

export function useSettings(): SettingsValue {
  return useContext(SettingsContext) ?? DEFAULTS;
}

/**
 * Subscribe a component to language changes so its `t()` strings re-render in place when the locale
 * switches - without remounting (which would reset navigation). Used centrally by the `localized()`
 * screen wrapper in AppNavigator (React Navigation isolates screens from ancestor re-renders, so each
 * screen must subscribe itself); screens don't call this directly. See 007 FR-005.
 */
export function useLocale(): Locale {
  return useSettings().locale;
}

export function SettingsProvider({ children }: { readonly children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [appLock, setAppLockState] = useState(false);
  const [scanAttachments, setScanState] = useState(false);
  const [telemetry, setTelemetryState] = useState<boolean | null>(TELEMETRY_DEFAULT);
  const [ready, setReady] = useState(false);

  // Keep the i18n module in sync with the active locale before children render.
  setActiveLocale(locale);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [tm, lc, lock, scan, telem] = await Promise.all([
        settingsStore.getSetting(THEME_KEY),
        settingsStore.getSetting(LOCALE_KEY),
        settingsStore.getSetting(APP_LOCK_KEY),
        settingsStore.getSetting(SCAN_KEY),
        settingsStore.getSetting(TELEMETRY_KEY),
      ]);
      if (!alive) {
        return;
      }
      if (tm === 'light' || tm === 'dark' || tm === 'system') {
        setThemeModeState(tm);
      }
      if (lc === 'cs' || lc === 'en') {
        setLocaleState(lc);
      }
      if (lock === '1') {
        setAppLockState(true);
      }
      // Only an explicit '1' enables it. Anything else - absent, '0', or a value from some future
      // version - means off, because the safe reading of "we are not sure" is "do not read the
      // user's mail".
      // ABSENT means unanswered, and stays `null`: the user has not declined, they have not been
      // asked, and `TelemetryConsent` is what asks them. Only an explicit '0' or '1' is an answer.
      if (telem === '0' || telem === '1') {
        const on = telem === '1';
        setTelemetryState(on);
        setTelemetryEnabled(on);
      }
      if (scan === '1') {
        setScanState(true);
      }
      // `syncInterval`, `syncReceived`, `syncSent`, `syncCadence`, `notifPrimed` and `notifChannels`
      // are no longer read: 014 removed background sync, so none of them has anything left to switch
      // on. The rows stay in `app_settings` rather than being migrated away - they are inert, and a
      // migration that deletes user data is a migration that can go wrong for no gain.
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    void settingsStore.setSetting(THEME_KEY, mode);
  };

  const setLocale = (next: Locale) => {
    setActiveLocale(next);
    setLocaleState(next);
    void settingsStore.setSetting(LOCALE_KEY, next);
  };

  const setAppLock = (enabled: boolean) => {
    setAppLockState(enabled);
    // Settled here, because nobody waits for it: removing the last box calls this after the vault has
    // switched the lock off, and a write that failed there was an unhandled rejection. The vault's own
    // write is the one the lock follows (`Vault.forget`, `enable`, `disable`); this mirrors it, so a
    // failure is reported and the screen keeps what the vault did.
    settingsStore.setSetting(APP_LOCK_KEY, enabled ? '1' : '0').catch(e => {
      reportFailure('settings.write', e, { stage: 'persist' });
    });
  };

  const setTelemetry = (enabled: boolean) => {
    setTelemetryState(enabled);
    // Tell the reporter immediately: consent is checked in `beforeSend`, so this takes effect on the
    // next event rather than the next launch.
    setTelemetryEnabled(enabled);
    void settingsStore.setSetting(TELEMETRY_KEY, enabled ? '1' : '0');
  };

  const setScanAttachments = (enabled: boolean) => {
    setScanState(enabled);
    void settingsStore.setSetting(SCAN_KEY, enabled ? '1' : '0');
  };

  return (
    <SettingsContext.Provider
      value={{
        themeMode,
        locale,
        appLock,
        scanAttachments,
        telemetry,
        ready,
        setThemeMode,
        setLocale,
        setAppLock,
        setScanAttachments,
        setTelemetry,
      }}>
      {children}
    </SettingsContext.Provider>
  );
}
