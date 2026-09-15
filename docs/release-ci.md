# Release CI/CD on GitHub Actions - plan (signed release builds not yet implemented)

**Status:** partly built. Captured so we don't forget.

Done since this was written: the repo lives at **`Dorhawk-Software/obalka`**, `.github/workflows/`
holds **`ci.yml`** (typecheck, lint, tests, attributions, shipped-dependency audit, palette check - the same
checks `npm run verify` runs locally - plus a separate Trivy secret-scan job, and an unsigned iOS build against the device SDK on Xcode 26) and **`ios-sideload.yml`** (an
UNSIGNED ipa for sideloading, plus Sentry dSYM and source-map upload). What is still unbuilt is the part
this doc is about: **signed** release builds and store delivery.

## Goal

Host the project on **GitHub** and use **GitHub Actions** to produce **signed
release builds** for both mobile targets:

- **Android** - signed `.aab` (Play) and/or `.apk`.
- **iOS** - signed `.ipa` (TestFlight / App Store), built on a **macOS runner**.

> **"Mac" interpretation:** this app is React Native CLI **mobile** (iOS + Android). "Build for Mac"
> is read as **the iOS/Apple build, which *requires* a macOS runner** - not a native macOS desktop
> app. If a real macOS desktop build is wanted, that's a separate effort (`react-native-macos`) and
> should be called out explicitly.

## Two workflows

1. **CI (checks)** - **built:** `.github/workflows/ci.yml` (push to `main`, every PR, a weekly schedule,
   manual run), on `ubuntu-latest`, no signing. Its `check` job runs the `npm run verify` checks
   (`npx tsc --noEmit`, `npm run lint` with `curly: all`, `npm test`, attributions, shipped-dependency
   audit, palette check); its `secrets` job runs a Trivy secret scan. See that file. (Planned here as
   a three-check workflow on `main`/`master`.)
2. **Release (build + sign)** - on a version **tag** push (`v*`). Two parallel jobs:
   - **android** on `ubuntu-latest`
   - **ios** on `macos-latest`
   - Artifacts uploaded to the workflow run (and optionally to Play Internal / TestFlight).

## Dependency advisories - closed 2026-09-14

Before the repository went public, GitHub's Dependabot listed nine open alerts on `main`, and `npm audit`
reported 10 vulnerable packages (6 moderate, 4 high: the two packages with advisories below plus the
packages that depend on them). After: `npm audit` finds 0 vulnerabilities and `npm run audit:shipped` sees 0 advisory
records.

| Alert | Reached through | Fix |
|---|---|---|
| image-size, 2 high (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq) | Metro 0.84.4 - build tooling, never shipped | No patched image-size exists. Metro 0.84.5 replaced it with vendored parsers. The lockfile moves the Metro family to 0.84.6, inside the `^0.84.3` ranges React Native already declares, so no override has to be remembered at the next RN upgrade. |
| decode-uri-component, 1 moderate (GHSA-vcc3-ghjq-m6fr) | @react-navigation/core 7 → query-string 7.1.3 - shipped | The fix is 0.5.0, but query-string 7 asks for `^0.2.2`, and no react-navigation 7 release moves off query-string 7. An `overrides` entry in `package.json`, scoped to query-string, forces `^0.5.0`. `patches/query-string+7.1.3.patch` makes query-string take 0.5.0's ESM default export. Overriding query-string to 9.5 instead was ruled out: it exports only a default, and core 7 does `import * as queryString`. |
| concurrent-ruby, 1 high + 2 low; activesupport, 3 moderate | `Gemfile` - the CocoaPods tooling | Floors `>= 1.3.7` and `>= 7.2.3.1` replace the React Native template's `< 1.3.4` cap and `>= 6.1.7.5`. The cap guarded activesupport before 7.1 against concurrent-ruby 1.3.5 no longer loading `logger`; 7.2 loads it itself. activesupport 7.2 needs Ruby 3.1, so the Gemfile now asks for `>= 3.1.0`. The floor also admits activesupport 8.0 before 8.0.4.1 and 8.1 before 8.1.2.1, which the same three advisories cover; no CocoaPods can resolve them, because cocoapods-core requires activesupport `< 8` in every release up to 1.17.0. |

Evidence:

- **Decoder behaviour.** Scratch differential of query-string 7.1.3 with decoder 0.2.2 against the patched 7.1.3 with 0.5.0, over 60,011 generated queries: `parse` and `stringify(…, {sort: false})`, the two calls react-navigation makes, gave identical output on every one. On 2,402 characters of malformed percent-encoding, the old pair took 12.4 s and the patched pair 0.3 ms. 0.3.0 stopped decoding `+` as a space, but that never reaches `parse()`, which replaces `+` itself before decoding.
- **Ruby.** In `ruby:3.3-slim` and `ruby:3.4-slim` containers, `bundle lock` on the new Gemfile resolves activesupport 7.2.3.2, concurrent-ruby 1.3.8, cocoapods 1.15.2 and xcodeproj 1.25.1. Once a compiler is added (`build-essential`; bigdecimal builds a native extension, and the old Gemfile needs it too), `bundle install` succeeds, and cocoapods and active_support load together; the old cap existed to prevent a load-time crash. The review repeated the lock and the load in `ruby:3.3-slim` and got the same versions. As a non-root user, `pod --version` gets past loading and then stops at CocoaPods' own check for a `git` executable, which the slim image lacks. The old Gemfile stops at the same point. No `Gemfile.lock` is committed, as before. CI's `ios-sideload.yml` runs the runner's own `pod`, not `bundle exec`, so it is unaffected.
- **Install path (review re-check, 2026-09-14).** Nothing below ran `npm ci`, Metro or a device:
  - npm's own lockfile check (the arborist comparison `npm ci` runs before installing) finds the lockfile in sync with `package.json`, with the override edge valid.
  - `npm install --package-lock-only` reproduces the committed lockfile byte for byte.
  - Every changed tarball matches its lockfile integrity hash.
  - patch-package 8.0.1 applies the patch to a pristine query-string 7.1.3.
  - The decoder and the patched query-string, run through the project's Babel config, compile with the bundled `hermesc`. The decoder comes out as `exports.default`, the export the patch reads.
- **Guard.** `__tests__/security/dependencyAdvisories.test.ts` fails when any of these happens:
  - a lockfile brings back image-size or a decoder older than 0.5.0;
  - the override or the patch goes missing (the decoder tests run the installed query-string and react-navigation's `getStateFromPath`/`getPathFromState` on hostile input and on Czech text);
  - the Gemfile floors are lost, which React Native's upgrade helper does whenever it copies the template Gemfile back in.

  Every one of its tests fails against the pre-fix lockfile, Gemfile and `node_modules`.
- **Audit gate and licences.** `scripts/audit-shipped.mjs` no longer accepts decode-uri-component. That acceptance argued that nothing could reach the decoder; with the fixed decoder shipping, the argument is no longer needed. The Licence screen list (`src/content/attributions.generated.ts`) now names decode-uri-component 0.5.0 and metro-runtime 0.84.6.

Still open:

- When @react-navigation/core moves to query-string 9.5 or later, delete the override and the patch together. The react-navigation 8 alphas already ask for `^9.4.0`.
- A `node_modules` installed before this change still holds the old Metro, query-string and decoder, and `npm run attributions:check` will then disagree with the committed list. Run `npm ci`.
- Not yet seen on a device: a Metro 0.84.6 release bundle, and the navigator loading the ESM decoder under Hermes.

## Android job (ubuntu-latest)

- Toolchain: `actions/setup-node` (+ npm cache), `actions/setup-java` **JDK 17** (RN 0.86 / AGP needs
  17), Android SDK (preinstalled on the runner or `android-actions/setup-android`).
- `npm ci` → `cd android && ./gradlew bundleRelease` (AAB) and/or `assembleRelease` (APK).
- **Signing:** release keystore provided as a base64 GitHub secret, decoded at build time; alias +
  passwords as secrets. Do **NOT** commit the keystore (same discipline as never-committing creds).
- **ABIs:** release must build the real device ABIs (`arm64-v8a`, `armeabi-v7a`, `x86_64`) - the
  dev shortcut of a single x86_64 ABI (used for the emulator) is **not** acceptable for release.
- Cache: `~/.gradle`, npm.

## iOS job (macos-latest)

- Toolchain: `actions/setup-node`, select Xcode (`maxim-lobanov/setup-xcode`), Ruby 3.1 or later +
  `bundle` for CocoaPods (the `Gemfile` floors need it; see Dependency advisories above), `cd ios && pod install`.
- Build: `xcodebuild archive` → `xcodebuild -exportArchive` (or **fastlane** `gym`) → `.ipa`.
- **Signing:** Apple distribution certificate (.p12) + provisioning profile via secrets, or
  **fastlane match** (encrypted certs in a private git repo). Upload via **App Store Connect API key**
  (issuer id + key id + `.p8`) → TestFlight.
- ⚠️ **Cost:** on a **private** repo, macOS minutes bill at a **10× multiplier**. Keep iOS builds on
  **tags only** (not every push). A **self-hosted Mac** runner is the cheaper long-term option.
- Cache: CocoaPods (`ios/Pods`), Ruby gems, npm.

## Secrets to provision (GitHub → Settings → Secrets)

- **Android:** `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`. (Optional Play upload: a service-account JSON.)
- **iOS:** distribution cert `.p12` + password, provisioning profile, **or** fastlane match repo +
  passphrase; App Store Connect API key (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`).

## Versioning (keep in sync)

A release tag `vX.Y.Z` should drive **all** version surfaces:
- `package.json` `version`
- `src/app/appInfo.ts` `APP_VERSION` (the Settings → About string; today a hand-kept constant)
- Android `versionName` + an incrementing `versionCode`
- iOS `CFBundleShortVersionString` + `CFBundleVersion` (build number)

Ideally derive these from the tag at build time so they can't drift (a small pre-build step), and bump
`APP_VERSION` automatically rather than by hand.

## Prerequisites before this can work

- ~~A **private GitHub repo** created; push the project; add `.github/workflows/`.~~ Done.
- **Keep the repository public.** The Settings → *Zdrojový kód* row links to `github.com/Dorhawk-Software/obalka`
  and `LICENSE` is MIT in the name of "The Obálka contributors" — both assume source anyone can fetch. If the
  repository ever goes private again, remove that row (`src/app/appInfo.ts`, `SettingsScreen.tsx`) rather
  than ship a dead link.
- **Apple Developer Program** membership + an App Store Connect app record + a bundle identifier.
- An Android **release keystore** generated and a Play Console app (if publishing).
- The native release configs wired (`android/app/build.gradle` signingConfigs from env; iOS export
  options / signing).
- Final **bundle id / package name** decided (ties into ASO - see `docs/aso.md`).

## Open decisions

- Distribution: raw artifacts only, or auto-publish to **TestFlight** + **Play Internal**? (fastlane?)
- Code-signing approach: manual secrets vs **fastlane match** (iOS).
- Self-hosted macOS runner vs paid macOS minutes (cost vs setup).
- Also produce an unsigned/preview **debug APK** for quick tester sideloading?
- Confirm the **"Mac" = iOS** interpretation above (vs a real macOS desktop app).
