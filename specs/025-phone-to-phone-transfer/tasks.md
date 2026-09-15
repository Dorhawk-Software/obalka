# Tasks — phone to phone with a code phrase (025)

Ordered so the thing that can kill the feature comes first. **Nothing below Phase 0 starts until T003
has a number**, because a 40 MB binary for a once-per-phone-lifetime feature is a reason to stop, and
finding that out after the UI is built is the expensive way to learn it.

Status counted from the boxes here; `specs/README.md` reads this file.

## Phase 0 — the gate

- [x] T001 **Done 2026-09-13.** A throwaway gomobile binding of `schollz/croc/v10/src/croc` — the
  wrapper from `research.md` §2, built to `.aar` and `.xcframework`, doing nothing but `Send` and
  `Receive` of one file. Never wired to the app, never committed to `src/`.
  The wrapper compiled against croc's real API first try, which confirms §2 was reading the API and not
  a summary of it: `croc.NewCtx`, `Options{SharedSecret, OnlyLocal, RelayAddress, Curve, HashAlgorithm}`,
  `GetFilesInfo`, `Client.Send`/`Receive`.
  gomobile produced exactly the surface §2 predicted:
  ```java
  public static native void send(String path, String secret, boolean onlyLocal, Progress p) throws Exception;
  public static native void receive(String dir,  String secret, boolean onlyLocal, Progress p) throws Exception;
  public interface Progress { void step(String stage, long sent, long total); void relayed(boolean); }
  ```
  Errors arrive as Java exceptions and the callback interface bound cleanly, so the TurboModule above
  it is ordinary work.
  **Finding worth keeping: croc's library API assumes the CLI populated its defaults.** Leaving
  `RelayPorts` nil panics inside `setupLocalRelay` with `index out of range [0]` — a nil slice indexed
  at zero, not a validation error. Anything binding this library has to fill in the CLI's own defaults
  (`RelayAddress`, `RelayAddress6`, `RelayPorts`, `RelayPassword`), and T009 must do so explicitly
  rather than inheriting whatever a future croc decides they are.
- [x] T002 **Done 2026-09-13.** Built on `macos-15`, the runner the unsigned-IPA workflow uses
  (`gomobile bind -target=ios,iossimulator`, 53 s). Android was built locally against the project's own
  NDK 27.1.12297006. Throwaway workflows on branch `spike/025-gomobile-size`, deleted with it.
- [x] T003 **THE GATE — measured 2026-09-13. It passes on size, and size turned out not to be the
  interesting cost.**

  **Android, a real release APK, arm64-v8a:**

  | | bytes | |
  | --- | --- | --- |
  | baseline | 68,263,572 | 65.10 MB |
  | with the binding | 76,390,107 | 72.85 MB |
  | **delta** | **+8,126,535** | **+7.75 MB** |

  `-ldflags="-s -w"` changes nothing: Gradle already strips the `.so`, and an independent
  `llvm-strip` agreed with it to within 800 bytes, which is what makes the number trustworthy rather
  than a coincidence. Stripped per ABI it is remarkably even — arm64 7.75, armeabi-v7a 7.82,
  x86 7.88, x86_64 8.42 MB — so a universal APK carrying all four adds **31.87 MB** while a per-ABI
  split adds 7.75. That is a packaging choice, not a cost of the feature.

  **For scale: this is LESS than the dependency accepted the day before.** `libQuickCrypto.so` +
  `libcrypto.so` are 14.3 MB in the same APK.

  **iOS — a band, not a point, and the reason is worth recording.** The static device slice is
  **19.59 MB** (`strip` does not reduce it; it is a static archive, not a linked image). Vendored into
  the app it measured **+3.03 MB** on the IPA (18.63 → 21.66 MB) — but that figure is a FLOOR, not a
  cost: gomobile emits a static framework, nothing in the app calls it, and the linker dead-stripped
  almost all of it. The binary never reached the app bundle.
  Forcing the whole archive in with `-force_load` fails with duplicate symbols, and that failure is
  itself the finding: **CocoaPods was already linking it normally**, so force-loading linked it twice.
  The honest estimate for a real call site is therefore **~8 MB**, from the Android measurement of the
  identical Go program (8.12 MB of stripped arm64 code); the 19.59 MB static archive is mostly
  per-object metadata a final link discards. Pinning it exactly needs a call site, which is T008 —
  so this stays an estimate until then, labelled as one.

  **Verdict: continue.** Not because ~8 MB per platform is free, but because the project accepted 14.3
  MB for `quick-crypto` the day before and this is smaller. The real cost is not the bytes:

  * a **second toolchain** — Go and gomobile, on both CI runners, forever;
  * a **Go dependency tree that `gen-attributions.mjs` cannot see**, because it scans a Metro bundle.
    It needs a hand-maintained supplement entry, exactly as SQLCipher and OpenSSL have (T020);
  * croc's library API is **CLI-first** and has sharp edges (see T001).

  **A recommendation made here and then withdrawn the same day, because it was measured.** The first
  version of this verdict said to do 006 T012b (scanning the recovery QR) first, on the grounds that it
  removes the twenty-character typing for "a fraction of the commitment". That was a guess, and it was
  wrong. Priced on the same arm64 release APK:

  | | delta | new permission |
  | --- | --- | --- |
  | this feature (croc) | **+7.75 MB** | none |
  | 006 T012b (QR scanning) | **+15.54 MB** | CAMERA, the app's first |

  Scanning a QR is **twice the size of the transport it was supposed to be the cheap alternative to**,
  because a live scanner needs a camera preview engine (5.65 MB) and MLKit's bundled barcode engine
  (4.72 MB + models). See 006 T012b for the breakdown. So the sequencing argument is gone: if the
  twenty-character typing is worth removing, this feature removes it AND the file-shuffling, for half
  the bytes and no permission. **Proceed here.**

## Phase 1 — prove the properties, still throwaway

- [ ] T004 Two devices, one network, `OnlyLocal: true`, with a packet capture proving nothing reaches
  croc's relay hosts (`croc.schollz.com`, `croc6.schollz.com` for croc v10.7.0; re-check
  `models.DEFAULT_RELAY` if croc is bumped) (SC-003). This is the claim the privacy copy will make, so
  it is measured, not assumed — the same standard `bulkCipher.ts` was held to when XChaCha20 turned out
  to be unavailable.
  **Sharpened by the T001 run, and this changes FR-007.** A successful transfer through the PUBLIC
  relay reported `Sending (->10.0.0.2:33208)` — a private address. So croc rendezvoused via the relay
  and then moved the bytes directly. "Did my mail cross a relay?" therefore has two answers that must
  not be collapsed: the *handshake* did, the *bytes* may not have. The on-screen wording has to be
  precise about which, and the `Relayed(bool)` callback has to report what actually happened rather
  than echoing the flag that was requested.
  Also a note on topology: two croc peers as two PROCESSES ON ONE HOST is not a usable test. croc's
  own local-relay machinery binds `127.0.0.1:9009`, which collides with a hand-started test relay, and
  the failure surfaces as a PAKE error (`could not secure channel`) that looks like a crypto problem
  and is not. This needs two hosts, or two devices.
- [x] T005 **Answered 2026-09-13, on the device, and the answer is no — deliberately.** Staged a send,
  let it reach the phrase, then `am force-stop`. The app does not come back to it and cannot: the
  phrase is one-time and dies with the rendezvous, so a fresh process has nothing to rejoin with.
  Resuming would mean persisting the phrase AND keeping the staged archive across launches, which is
  the opposite of what the rest of this feature is built to avoid.
  **The walk found a real defect on the way.** A killed send left **6.9 MB of sealed archive and
  `recovery.key`** in `cache/transfer`, and relaunching did not touch them — nothing swept until
  somebody happened to start another transfer. `abandon()` covers walking away and `offer()` covers
  the next transfer; neither covers the process simply ending, which Android does without asking.
  The key is the half that matters: it opens the whole backup, it lives in the Keystore, and it is
  written to disk only for the seconds a transfer needs it. A kill turned "seconds" into
  "indefinitely" — a different security property than the one this was designed with.
  Fixed with `sweepStale()` on app start-up (`App.tsx`), and re-walked: staged 6.9 MB + key →
  force-stop leaves both → relaunch and both are gone, app up as normal.
  **Still unmeasured:** croc's own per-chunk resume WITHIN a connection. That needs two hosts and a
  Go toolchain, neither of which is available here — and it is moot for this app, which cannot offer
  the same phrase twice anyway.
  A second finding, in the suite rather than the app: `fakeTransport.send` resolved immediately, so
  the cleanup hanging off `done` had already run by the time the abandon test called `abandon()`. It
  passed whether or not `abandon` did anything — found by mutating `sweepStale` and watching the new
  test stay green. `hang()` now makes a send that nobody takes up actually hang, and both cases fail
  when their cleanup is removed.
- [x] T006 **Done 2026-09-13, on the device.** Progress arrives as real counts and drives the bar
  without a fake timer - watched going `connecting` → `preparing 4 z 9` → `finishing 22/22` on a real
  transfer. Cancel works through the whole stack: tapping "Zrušit přenos" while a send waited for a
  receiver stopped the Go side and left `cache/transfer/out` gone rather than holding 7 MB of sealed
  archive.
- [~] T007 **Android done 2026-09-13** (+0 permissions from croc, +1 CAMERA). **iOS owed:** measure the
  delta when the xcframework lands (T022); `NSCameraUsageDescription` is already present. The croc
  binding adds **no permission at all** (priced at T003 on the arm64 release APK: no new permission).
  The code scanner adds exactly **one, CAMERA**, and it is declared in OUR manifest with a comment
  saying what it is for - the vision-camera libraries themselves declare only an optional
  `uses-feature`, so a phone without a camera still installs and simply is not offered the scan button.
  Notably absent: `RECORD_AUDIO`. vision-camera supports the microphone and declares it as a feature;
  the permission appears only if the app asks, and this app does not.
  iOS carries `NSCameraUsageDescription` with the same sentence.

## Phase 2 — the module

- [x] T008 **Done on Android 2026-09-13; iOS reports unavailable until its framework is wired** (T022).
  `services/transfer/transport.ts` is the seam; `nativeTransport.ts` is the only file that knows a
  native module exists, resolving it PER CALL the way `bulkCipher.ts` does. The Kotlin side
  (`TransferModule.kt`) loads the Go class REFLECTIVELY, which is what lets the archive be optional:
  linking against it directly would make the whole app fail to compile without Go and the NDK
  installed.
  **Walked on the emulator: the app builds, installs and runs with NO Go archive at all** (FR-013) —
  the feature is simply absent rather than the screen breaking.
- [x] T009 **Done 2026-09-13.** `native/transfer/` + `scripts/build-transfer-aar.sh`. Its whole
  surface is two calls over a path and a phrase, so FR-001 is enforced by there being no call that
  could break it. The `.aar` is gitignored and built by the script, so a developer who never touches
  this feature never installs Go or the NDK.

  **Proven between two real hosts** — the app on the emulator sent to a Go receiver on the
  workstation, `available=true`, progress events flowed, and the bytes arrived intact. That run found
  two defects no unit test would have:

  * **croc recreates the directory it was given.** The bundle landed at `<in>/out/backup.obalka`
    instead of `<in>/backup.obalka`, where the controller looks — so the wrapper now sends the
    CONTENTS of the directory and the two sides agree.
  * **`relayed` was echoing the flag.** It reported `relayed=true` while the bytes went straight to a
    private address. It now watches croc's `ExternalIPConnected` and answers from what actually
    happened: `null` until a route exists, then the truth. `onlyLocal` is the one case that can be
    stated up front, because there it is a guarantee rather than an observation. Re-run on the
    device: `relayed=null → false`, and the file landed flat.
- [x] T010 **Done 2026-09-13.** `services/transfer/codePhrase.ts`. 4 symbols from the recovery key's
  32-character alphabet (20 bits) + 4 words from a 256-word list in the active locale, Czech or
  English (32 bits): **52 bits**, written down as a constant so a later change that shortens it has to
  argue with the number. 256 words exactly, because one CSPRNG byte then picks one with no modulo
  bias — the property `recoveryKey.ts` gets from its 32-symbol alphabet, and a test pins it.
  ~~Czech words on purpose: this is read aloud across a table by somebody who has just lost a phone,
  and an English list would be the one part of the app that stopped being in their language at the
  worst moment.~~ *Amended 2026-09-14:* the words come from the active locale's list, Czech or
  English, for the same reason — the phrase is read aloud by somebody who has just lost a phone, in
  their own language. Parsing accepts either list, so two phones set to different languages still
  pair. Every word is ASCII and distinct in its first four letters. Parsing forgives case, spaces,
  commas and the O/0, I/1, U/V substitutions people make from their own handwriting — but REFUSES a
  word that is not on the list rather than correcting a near-miss, because a silently corrected
  phrase is how somebody hands their archive to a stranger's phone.
- [x] T011 **Done 2026-09-13.** `__tests__/transfer/` — 19 tests over a completely fake transport.
  What is pinned is the ORDER, because that is where an archive gets destroyed: the manifest is read
  before the payload is trusted, `receive` writes nothing, a bundle that is not ours is refused as
  what it is, and the scratch directory is swept whether the transfer succeeded or failed. Also that
  the transport is handed a PATH and never bytes, which is how FR-001 is enforced rather than
  promised.
- [x] T020 Go licence supplement: `scripts/go-attributions.mjs` + `scripts/go-modules.json` list the Go
  modules inside the transfer archive, which `gen-attributions.mjs` cannot see from the Metro bundle.

## Phase 3 — the feature

- [x] T012 **Done 2026-09-13.** `features/transfer/state/transferController.ts`, `offer()`. Reuses
  `packPortable` and adds no second payload builder. The phrase and the size are both known before a
  byte moves (FR-008), and the recovery key rides beside the archive rather than being typed at the
  end — written as a separate file so neither format has to learn about the other, and so a bundle
  that leaks is still just a sealed archive.
- [x] T013 **Done 2026-09-13.** `receive()` then `apply()`, two calls rather than one, so there is a
  moment between "we have it" and "it is in your archive" that the user has to pass through (FR-004).
  `receive` fetches, unpacks, judges compatibility from the manifest and stops. `apply` is
  `restoreBackup` and nothing else (FR-003) — it grew no SQL. The bytes are already in hand, so the
  restore is handed a target that answers that one archive from memory: the receiving phone did not
  make this backup and must not start listing it as its own just to be able to read it.
- [x] T014 **Done 2026-09-13, and FR-009 turned out to be half impossible — see below.** The Tier 2
  objects travel beside the archive, and the receiving side answers `getObject` from what ARRIVED
  rather than from its own store: this phone never held those objects and must not start listing them
  as its own just to be able to restore them.
  EVERY object is sent rather than only the ones this backup's index names. Reading the index would
  mean a second Argon2id derivation and a full decrypt purely to enumerate, before the phrase could
  even be shown; with the default retention of one backup the two sets are identical anyway, and an
  object the receiver's index does not mention is simply never opened.
  The staged directory now survives a successful `receive` and is swept by `apply` or `dispose`. That
  is a deliberate lifecycle change: documents are the one part of a transfer that can be gigabytes,
  so they stay on disk across the question the user still has to answer.

  **FR-009 amended.** It reads "MUST be resumable, and MUST NOT re-send a document object the
  receiver already holds". ~~The first half stands — croc resumes per chunk.~~ *Amended 2026-09-14:*
  the first half does not hold either: a transfer killed with its process is not resumed (T005), and
  croc's own per-chunk resume within one connection is unmeasured. The second half is not
  achievable over this transport: knowing what the far side already has needs a back-channel, and a
  croc transfer is one-way from the moment the phrase is matched. Cross-wire dedup would need a
  protocol of our own on top, which is a much larger thing than this feature. What IS true is that a
  re-run sends the same bytes and the receiver's content-addressed store recognises them, so nothing
  is duplicated ON DISK — the cost is bandwidth, not storage. Written down rather than quietly left
  unimplemented.

  *Amended 2026-09-14:* **the receiving phone never restored the documents.** `apply` called
  `restoreBackup` without its document-restore option, so the objects travelled, were staged, were
  never read, and were swept - "Obnoveno" meant the metadata alone, and the details kept pointing at the
  sending phone's paths. The walk did not catch it because the archive received on the device (T019)
  carried no documents. The controller now takes the same `DocumentRestore` the backup screen's restore
  passes (`features/accounts/deps.ts`), and signed originals (004 amendment) travel with the
  attachments. Tests: `__tests__/transfer/transferController.test.ts`, "writing back the documents that
  travelled (US1 scenario 3)" - a document restored byte for byte into this phone's attachment
  directory, and one that did not travel counted as missing - and "writes the documents that came with
  it back, signed original included (004)". ~~Still open: unlike the backup screen's restore, a transfer
  keeps neither the recovery key nor the document key that arrived with it, and `copyDocuments` / the
  staged `getObject` read each object whole.~~ Not walked on two phones since the change.

  *Amended 2026-09-15 (review follow-ups), in code and tests, not walked on a device:*
  * **The keys that arrive are kept.** After the restore, `apply` keeps the recovery key and the
    document key where this phone has none, through `adoptRestoredKeys`
    (`features/backup/state/backupController.ts`), which the backup screen's restore now shares. It
    stores the document key first. Storing the passphrase asks for the screen lock on Android and can
    be declined, and in the old order a declined prompt lost the document key too. A failure there is
    reported (`keysFailed`) and the screen adds "Heslo k záloze se do tohoto telefonu nepodařilo
    uložit." (`transfer.done.keyNotSaved`). The archive is restored either way. Wiring: `keys` in
    `features/accounts/deps.ts`.
  * **Documents are never held whole.** `BackupFs.open` (`services/backup/fileTarget.ts`) is a
    slice reader, on the device the `fs.slice` one `documentSource` already used (it now delegates).
    `copyDocuments` copies slice by slice and checks a stop between slices too. The staged target and
    the file target answer `getObject` through `chunksOnRequest` (`services/files/sliceSource.ts`),
    which holds one slice at a time.
  * Tests: `__tests__/transfer/transferController.test.ts`, "never holding a document whole" (2),
    "reads each document that arrived a slice at a time, never whole", "keeps the recovery key and the
    document key that arrived, as the backup screen s restore does (006)", "still reports the save
    when the password cannot be kept, keeps the document key, and says so";
    `__tests__/app/transferScreen.test.tsx`, "says when the backup password that arrived could not be
    kept" and "hands the save the backup screen s prompt title…";
    `__tests__/backup/fileTarget.test.ts`, "reads a document back a slice at a time, never whole";
    `__tests__/files/sliceSource.test.ts`, "answering requests for bytes from a slice reader" (3);
    `__tests__/backup/backupController.test.ts`, "keeps the document key even when storing the
    passphrase is refused". Each fails against the code before the change.
  * **Found reviewing that pass, the same day: the kept key could be overwritten from the backup
    screen.** That screen stays mounted under the transfer it opens and read its status only on mount
    and when a run ended. After a transfer kept the key it went on showing backups as off, and switching
    them on (`BackupController.enable`) minted a new key over the kept one - the one the user holds on
    paper from the old phone - and cleared it outright when that first backup failed. `enable` now
    backs up under a key the phone already holds (`backupNow`) and clears only a key it minted itself.
    The screen reads its status again when it comes back into view (`shownAgain`, counted from the
    route's `blur`/`focus` in `app/AppNavigator.tsx`). Tests: `__tests__/backup/backupController.test.ts`,
    "backs up under the key a transfer kept, and never replaces or clears it";
    `__tests__/app/backupScreen.test.tsx`, "reads the status again when it comes back into view, so
    backups a transfer turned on show as on". Each fails against the code before the change. ~~The
    navigator's `blur`/`focus` wiring itself has no test and no device walk.~~

  *Amended 2026-09-15 (edge-case pass), in code and tests, not walked on a device:*
  * **The return counter has tests.** It moved out of `BackupRoute` into `useViewPresence`
    (`app/AppNavigator.tsx`), which also says whether the screen is in view (used by T021 below).
    `__tests__/app/backupRouteFocus.test.tsx`: "counts each return into view - never the first focus -
    and says whether the screen is in view" and "starts out of view for a screen that mounts covered"
    fail against the code before the change, which had no hook to test; "reads the backup screen again
    when it comes back from the transfer it opened" mounts the navigator, goes Backup, Transfer, back,
    and fails when the route stops passing the count to the screen (checked by passing 0 instead).
  * **A declined screen lock is a decision, not a failure.** Keeping the key that arrived reported
    every refusal as `backup.restore` / `persist`. `backupSecretStore.save` now rejects with
    `BackupPromptDeclinedError` when its prompt is declined (`isPromptDeclined` in
    `services/backup/backupSecret.ts`: BiometricPrompt code 10 or 13 in the message of Android's
    `E_CRYPTO_FAILED`, or iOS `errSecUserCanceled`, -128; code 5, the system withdrawing the prompt, and
    lockouts stay failures). `keepKeys` traces that as `backup.restore` with `outcome: 'declined'`, a new
    fixed-value key on the scrubber's allow-list, instead of reporting it. `keysFailed` and the sentence
    on screen are unchanged. Tests: `__tests__/security/keychainPrompts.test.ts`, "a declined prompt when
    storing the passphrase" (2); `__tests__/transfer/transferController.test.ts`, "traces a declined
    screen lock as the person s decision, and reports only a real failure". Each fails against the code
    before the change. The Android codes were read from react-native-keychain 10
    (`ResultHandlerInteractiveBiometric.onAuthenticationError`), not seen on a device.
  * *Reviewed the same day:* the classification moved into `keepRestoredKeys`
    (`features/backup/state/backupController.ts`), which the backup screen's own restore now shares.
    That restore no longer rejects when the password cannot be kept (006 T030). The iOS code string
    (`"-128"`) was checked against `codeForError` in react-native-keychain's `RNKeychainManager.m`.
  * *Amended 2026-09-15 (001 T037 review), in code and tests, not walked on a device:* **the app lock
    stays on the sending phone.** Saving what arrived goes through `restorePayload`, which now skips the
    device-local settings (`DEVICE_LOCAL_SETTINGS`, 006 T006): the box the sending phone had open, its
    merged view, its app lock and the mark of a box removal that did not finish there. A sending phone
    with the lock on armed a lock on the receiving phone, whose vault key never travels, and the first
    unlock there moved that phone's own key behind a prompt nobody had switched on. Test:
    `__tests__/backup/deviceLocalSettings.test.ts`, "do not arm the app lock on a phone whose vault key
    did not travel", which fails against the code before the change. *Review 2026-09-15:* the
    diagnostics answer stays on its phone too (006 T006): the receiving phone has answered the question
    before it can reach the transfer screen, and a sending phone's "yes" replaced its "no". Test:
    "keep the diagnostics answer given on this phone when the backup says yes".
- [x] T015 **Done 2026-09-13.** One screen, `app/settings/TransferScreen.tsx`, reached from a row on
  the backup screen — next to the file export, because they answer the same question and somebody
  comparing them should see both at once. Sending shows the phrase in the recovery key's own type
  treatment (this gets read across a table) and the size beside it. Receiving fetches, then STOPS and
  asks, naming the date and the size (FR-004). Not gated on backups being enabled: the phone that
  receives has never had them on.
  *Amended 2026-09-14 (US1 scenarios 1 and 3):* beside the phrase is now what goes, counted: "K
  odeslání: 3 schránky, 19 zpráv, 9 příloh, celkem 7,2 MB". Boxes and messages are counted from this
  phone's archive the way `buildPayload` enumerates them, documents come from the manifest's
  `documentCount`, and the size stands alone when the archive cannot be counted. Counts stay out of
  the manifest (006 FR-011). The limit, stated in `TransferContents`: the archive is counted as it is
  now and the backup that travels is the archive as it last settled, so with automatic backups off
  the counts can run ahead of it. The receiving phone ends with "Obnoveno: 1 schránka, 3 zprávy, 9
  příloh." in the same words and order, then how many documents did not land. Tests:
  `transferController.test.ts` "saying what a send carries (US1 scenario 1)"; `transferScreen.test.tsx`
  "counts both phones can be read against (US1 scenarios 1 and 3)"; `czechAgreement.test.ts` covers
  the two new counted families.
- [x] T016 **Done 2026-09-13.** Both locales. The route line has THREE states, not two, and the
  device run is why: until a route is negotiated the only honest answer is "working it out". The
  relayed sentence says what the relay can see (size, timing) AND what it cannot (contents, encrypted
  before anything is sent) — a user told only "this went through a relay" has been given a worry
  rather than an answer. FR-011 is said at the end, where somebody stands who thinks the job is
  finished.
  *Amended 2026-09-14 (US3 scenario 2):* the relayed sentence also NAMES the relay: `croc.schollz.com`,
  and `croc6.schollz.com` on IPv6, which croc tries first. `TRANSFER_RELAY` in
  `services/transfer/transport.ts` was read from croc v10.7.0 (`models/constants.go`, and the relay
  loops in `croc.go`); `__tests__/transfer/relayHost.test.ts` holds it against `native/transfer/go.mod`
  and the relay options in `transfer.go`, and `transferScreen.test.tsx` "naming the relay (US3
  scenario 2)" checks the line on screen.
  *Reviewed 2026-09-14:* the longer sentence made an old layout jump worse (constitution V). The
  route line changes from one line to the relayed sentence mid-transfer, and it pushed the cancel row
  down. The longest of the three sentences is now laid out invisibly and hidden from screen readers
  (`routeReserveText`), and the true one is drawn over it. Tests: `transferScreen.test.tsx`, "a route
  line that does not move what is under it (constitution V)", two tests, one of which fails if a
  rewording makes another sentence the longest.
- [x] T017 **Done 2026-09-13.** Four outcomes kept apart, not one: a phrase that is not even the
  right SHAPE never costs a handshake at all, a refused phrase says to ask for a fresh one, a broken
  transfer says so, and a build without the native module says THAT. Tested as four separate
  assertions, because collapsing any two is what sends somebody chasing a network problem they do not
  have.
- [x] T018 **Done 2026-09-13.** The question is asked BEFORE anything is staged, because the total -
  archive plus documents - is already in the manifest (006 T024 put it there), so nothing has to be
  built to know what a transfer will cost.
  `isMetered()` returns `boolean | null`, and the null is the useful part: "not known" must not be
  read as metered, which would put a confirmation in front of every transfer on a build without
  NetInfo, and must not be read as free either. It believes the platform's own
  `isConnectionExpensive` over the connection type, because that knows about metered Wi-Fi which a
  type check would call free.
  The threshold is 5 MB and it is a judgement, not a measurement: a metadata-only archive is about
  15 kB and asking about that is noise, while the documents tier always trips it.
  **Cost: 0.02 MB and no new permission** - `@react-native-community/netinfo` wants
  `ACCESS_NETWORK_STATE` and `ACCESS_WIFI_STATE`, both of which this app already carried. Release
  arm64 APK 88.53 → 88.55 MB, still 15 permissions.
- [x] T023 **Done 2026-09-13.** The phrase as a QR: `services/transfer/transferQr.ts` (prefix
  `OBALKAT:`, distinct from the recovery key's `OBALKA:`) and a shared scanner
  `features/transfer/screens/CodeScanner.tsx` that takes its parser as a parameter (also used by 006
  T012b) and is not offered without a camera (`scanningAvailable()`). Adds CAMERA (T007). The walk
  found a wrong barcode-format string and an error box on a phone with no camera.
- [x] T021 **Done 2026-09-14, in code and tests; not yet walked on a device.** A transfer is stopped,
  not paused, when the app leaves the foreground: a paused one could never be picked up again, because
  the phrase is one-time (T005).
  * `app/settings/TransferScreen.tsx`: while bytes are moving - an offer from staging to the last byte
    taken, a receive until what arrived is on screen - an AppState listener stops the run on
    `background` through `stopRun`, the cancel button's own path (`controller.abandon()` sweeps the
    staged archive and recovery key), and `transfer.stopped.background` is on screen when the user
    comes back. `background` rather than "leaves `active`" as first written here: iOS goes `inactive`
    for a pulled-down notification centre while the app is still on screen, and Android reports only
    the two. Leaving the screen mid-run stops the run too, and so does a run that starts while the app
    is already in the background. Not while the arrival question is open, and not during the restore:
    nothing is on the network then. ~~and the restore is one local transaction.~~ *Amended 2026-09-15:*
    it is not one: the rows commit in one transaction and the documents are written after. And the
    cancel row stayed on screen during it; see the amendment below.
  * `features/transfer/state/transferController.ts`: a stop while staging stops copying between
    documents and never reaches croc (`TransferCancelledError`, staging swept); a receive stopped
    before or while it runs is refused and swept, so its recovery key does not stay in the cache.
  * **Found on the way, and fixed:** the cancel button ended in "Přenos se nepodařil dokončit." as soon
    as the native side reported the stop as an error, and a stopped run's late progress could show up
    in the next run. Everything a stopped run reports afterwards is now dropped.

  * **Found in review, and fixed: the stop did not reach croc while the app was in the background.**
    The run's signal gets to the native module through a 200 ms JS interval in
    `services/transfer/nativeTransport.ts`. React Native on Android does not fire JS timers while the
    activity is paused (`JavaTimerManager.onHostPause`), and that is exactly when this stop is issued.
    So the screen said the transfer had stopped while croc went on moving bytes until the user came
    back. `Transport.cancel()` now goes straight to the module, and `controller.abandon()` calls it
    before anything awaits. ~~The module resets its flag at the start of every run, so a stop with
    nothing running does not carry over.~~ *Amended 2026-09-15:* that flag was one for every run and
    was reset when a run was requested, not when the worker started it. A run requested while a
    stopped one was winding down un-stopped the old run, and the old run's JS interval then stopped
    the new one. Each run now has an id (`nativeTransport.ts`) and its own flag in `TransferModule.kt`;
    see the amendment below.
  * **Found in review: the screen going off counts as leaving.** Android pauses the activity when the
    display times out, so a long transfer nobody touches is stopped too. Keeping the screen on would
    need native code (no keep-awake module is in the app), so this pass does not prevent it and says
    it instead: `transfer.stopped.background` names the screen going off and asks to keep it on. A
    stopped receive that is handed back anyway is now disposed of by the screen too, so its recovery
    key cannot stay on disk.

  Tests: `__tests__/app/transferScreen.test.tsx`, "only while somebody is watching (FR-014, T021)",
  nine tests with AppState driven by the test; `__tests__/transfer/transferController.test.ts`,
  "stopping a transfer (FR-014)", four, including "tells the transport to stop at once, before
  anything else is awaited"; `__tests__/transfer/nativeTransport.test.ts`, two, with fake timers that
  never run standing in for a paused activity. Each fails against the code before the change.
  ~~**Still open:** keeping the display on while bytes move (`FLAG_KEEP_SCREEN_ON`, a native change),
  and device walks of all of the above.~~

  *Amended 2026-09-15 (review follow-ups), in code and tests, not walked on a device:*
  * **Saving what arrived cannot be cancelled, and nothing runs beside it.** The cancel row stayed
    visible during `apply`. Pressing it returned the screen to idle while the restore went on, and a
    receive started then swept `in/`, the directory the restore was still reading documents from. The
    restore's own sweep would also have taken the new transfer's files. A cancel there cannot honour
    FR-012 (rows commit before the documents are written), so the save is not cancellable. The
    screen shows "Ukládám do archivu tohoto telefonu…" with the restore's progress and, in place of
    the route line, why there is no cancel (`transfer.applying.note`). The controller tracks the
    running `apply`: `offer` and `receive` are refused with `TransferBusyError` ("Předchozí přenos se
    ještě ukládá do archivu…"), and `dispose` and `sweepStale` leave its directory alone. A screen
    opened again during a save shows it and waits (`isApplying`, `whenApplied`).
  * **A stop reaches only its own run.** `send`/`receive` take a run id minted in
    `nativeTransport.ts`. `TransferModule.kt` keeps one `AtomicBoolean` per id, registered when the
    run is requested (so a stop issued while it is queued is kept) and removed when it ends.
    `cancel(runId)` and the 200 ms interval name their run, and `Transport.cancel()` names the run in
    flight, a no-op when none is. Progress events carry the id and other runs' events are ignored. A
    stopped run rejects with code `cancelled` (`TransferCancelledError`). `./gradlew
    :app:compileDebugKotlin` passes (JDK 17). The Go side is unchanged.
  * **The display stays on while a transfer is live** (an offer, a receive, and the save):
    `TransferModule.keepScreenOn` sets or clears `FLAG_KEEP_SCREEN_ON` on the activity window on the
    UI thread. The screen turns it on in an effect keyed on "live", so the cleanup lets it go on every
    exit path: done, failed, cancelled, unmounted. Not while the arrival question waits. iOS: T022.
  * Tests: `__tests__/app/transferScreen.test.tsx`, "saving what arrived" (5) and "keeping the display
    on while a transfer is live" (3); `__tests__/transfer/transferController.test.ts`, "saving what
    arrived, with nothing else meanwhile" (3); `__tests__/transfer/nativeTransport.test.ts`, "a stop
    reaches only the run it was meant for" (6) and "keeping the display on" (2). Each fails against the
    code before the change.
  * **Found reviewing that pass, the same day: a stopped run still swept the next run's files.** A
    per-run stop flag keeps the old run from STOPPING the next one, but the two still staged into the
    same `in/` or `out/`. The module lets a stopped run go at the moment it starts the next, so the old
    run's cleanup - the `receive` catch, or the sweep on the offer's `done` - landed while the new run
    was receiving into or sending from that directory; `abandon`, which the screen does not wait for,
    swept `out/` under a new offer too. Every offer and receive now stages into a directory of its own
    (`out/<run>`, `in/<run>`, `claimRunDir`), marked in use before it is created. Only the owning run
    sweeps it; the sweeps on the way in and `sweepStale` skip every directory in use (`sweepUnused`);
    `abandon` sweeps only the offers running when it is called; staging that fails part-way sweeps
    itself instead of leaving the recovery key for the next transfer. The Go receiver's `chdir` and the
    sender's file list take whatever directory they are given, so the native side is unchanged.
  * **A screen opened again during a save now says how it ended.** It showed the save, then went back
    to the buttons in silence. `whenApplied` resolves with the outcome (`ApplyOutcome`) and the screen
    shows the done sentence or the error (`errorText`), as the screen that started the save would have.
  * The English "this phone s archive" in `transfer.stage.applying` and `transfer.got.body` reads
    "this phone’s archive".
  * Tests: `__tests__/transfer/transferController.test.ts`, "a stopped run never sweeps the files of
    the next one" (2: the next receive keeps what it is receiving, the next offer keeps what it
    staged); the tests that named `/work/out` or `/work/in` now find the run's own directory, and "clears
    what a KILLED run left staged" sweeps from a second controller over the same cache, as the next
    process would. `__tests__/app/transferScreen.test.tsx`, "says how a save it found running ended, as
    the screen that started it would have". Each fails against the code before the change.

  *Amended 2026-09-15 (edge-case pass), in code and tests, not walked on a device:*
  * **A save and an automatic backup no longer overlap.** `apply` did not go through
    `BackupController`'s run tracking. On a phone with automatic backups on, a backup scheduled by a
    sync that had just settled could start while the save was writing the archive and keeping the keys,
    read the archive half written, and with the default retention of one prune the last good backup for
    that copy. The save, the restore and the keys together, now runs as `BackupController.runRestore`
    (`runs` in `features/accounts/deps.ts`): a restore run that cannot be cancelled. The controller also
    lets one run go at a time. A run asked for during another waits for it, and an automatic backup that
    comes due during one waits for quiet again, which closes the other direction too: a save started
    while a backup is still reading. The backup screen shows the save as a restore, and leaving it during
    the save just leaves, since a stop would do nothing (FR-012).
  * **A save that ends with no transfer screen open is said somewhere.** It was said nowhere. The
    controller now keeps the outcome until a screen takes it (`takeOutcome`, `subscribeOutcome`); the
    screen that saw the save end takes it, and one left during the save does not. The backup screen,
    where leaving the transfer lands, says it in a dialog titled "Přenos z druhého telefonu"
    (`transfer.outcome.title`) with the transfer screen's own sentences, while it is in view: at once if
    the save ends then, otherwise when it next comes into view (`inView` from `useViewPresence`). The
    transfer screen opened again after the save says it in its done or error line. The dialog moves
    nothing behind it (constitution V). If the user went further back than the backup screen, the
    outcome waits for the next visit to either screen.
  * Tests: `__tests__/backup/backupController.test.ts`, "one run at a time" (2: no automatic backup
    beside a transfer's save, and one after it; a save asked for during a backup waits for it);
    `__tests__/transfer/transferController.test.ts`, "saves as one run of the backup controller s, keys
    included, so no automatic backup overlaps it", "keeps how a save ended until a screen takes it, and
    tells a listener it ended" and "keeps the outcome before the caller hears the save end, so the screen
    that saw it can take it"; `__tests__/app/backupScreenTransfer.test.tsx` (3: leaving during the save
    just leaves; the dialog once back in view, not while covered, and only once; at once while in view,
    and a failure as a failure); `__tests__/app/transferScreenOutcome.test.tsx` (2). Each fails against
    the code before the change. The screen tests are in files of their own because
    `transferScreen.test.tsx` and `backupProgress.test.tsx` cannot render the screen any more times.
  * ~~**Found and not fixed in this pass:** an offer reads the archive of the newest backup the screen
    read when it opened, and an automatic backup can replace that archive in the meantime. With the
    default retention of one, the old archive is pruned, the send fails with "Přenos se nepodařil
    dokončit.", and trying again fails the same way until the screen is opened again. Read from the
    code, not reproduced.~~ Fixed in the review below.

  *Reviewed the same day (2026-09-15), in code and tests, not walked on a device:*
  * **A send takes the newest backup there is when it starts.** The screen still reads the newest
    backup once, when it opens, but `offer` (`newestToSend`) lists the store again and sends the newest
    backup it finds. If that archive goes between the listing and the read, it lists once more: an old
    backup is pruned only after the newer one is written. A listing that fails sends the backup the
    screen named, as before. Tests: `__tests__/transfer/transferController.test.ts`, "sends the newest
    backup, when an automatic backup replaced the one the screen read" and "looks again when the archive
    goes between the listing and the read".
  * **The outcome dialog waits for a dialog already open.** It is the only dialog on the backup screen
    that a tap does not open, so it can arrive while another is up (switching backups off, lowering the
    retention, the documents question, deleting a backup, or the key scanner). iOS presents one modal at
    a time, so it would never have appeared. It is taken all the same, and shown once the other closes.
    Test: `__tests__/app/backupScreenTransfer.test.tsx`, "waits for a dialog that is already open, and
    says it once that one has closed".
  * **A transfer screen on its way out leaves the outcome to the backup screen.** Going back takes the
    screen out of view at once, but it stays mounted until the transition out has finished, and a save
    that ended in that moment was taken there and said where nobody could see it. `TransferRoute` now
    passes `inView` from `useViewPresence`, and the screen takes an outcome only while it is in view.
    Test: `__tests__/app/transferScreenOutcome.test.tsx`, "is left for the screen underneath by one
    already out of view, though still mounted".
  * The review's eight new tests (these four, and the four in 006 T030 for the backup screen's restore
    and switching on) were run against the pass above and all failed; they pass now. The pass's own new
    tests were run against the code before it: 24 failed, and its navigator test, which passes on that
    code, failed once the route passed 0 for the count.
  * **Not changed:** the dialog has no scroll of its own (`theme/Dialog.tsx`, shared by every dialog in
    the app), so at the largest text sizes a long outcome can push its button below the screen. Back
    and a tap on the scrim still close it.

  *Backup polish, the same day (2026-09-15), in code and tests, not walked on a device:*
  * **A save is followed by a backup of what it wrote.** A phone that kept the key arriving with a
    transfer (T014) showed backups on and had no backup of what arrived: the transfer is not put in this
    phone's store, and nothing scheduled an automatic backup until the archive next changed.
    `BackupController.runRestore` now schedules one once the save has ended, with rows, documents and
    keys all in, after the usual quiet and never beside another run. A save that failed schedules none.
    A save that could not bring every document back schedules one all the same: unlike the backup
    screen's restore, the backup it came from is not in this phone's store, so the automatic backup
    replaces nothing that still holds those documents. Decided from 006 FR-017; see 006 T030. Test:
    `__tests__/backup/backupController.test.ts`, "backs up what a transfer s save wrote once the save has
    ended, and nothing after a save that failed", which fails against the code before the change.
  * The same pass made a stop reach a backup run that is still waiting, and made the backup screen's
    restore stoppable only until its rows are in (006 T030). Neither changes the save, which stays not
    stoppable.
  * Reviewed the same day (2026-09-15), in code and tests: the automatic backup a save now schedules
    runs from a timer nothing awaits. A failed read of the backup preferences at its start was an
    unhandled rejection. It is now reported like any other automatic backup failure (006 T030, "reports
    the failed read rather than letting it escape unhandled"). The save itself is unchanged.

  **Still open:** device walks of all of the above, and the iOS half (T022).

## Phase 4 — the walk

- [~] T019 **Both directions walked 2026-09-13; two phones on one Wi-Fi still owed.** The app on the
  emulator SENT a real archive with nine Tier 2 documents to a receiver on the workstation
  (7,202,144 bytes, intact), and then RECEIVED one back through its own screen: "Přijato z druhého
  telefonu — Záloha z 12.09.2026 20:17, 14 kB. Uložit do archivu tohoto telefonu?", then "Obnoveno:
  19 zpráv, 3 schránky. Do schránek se ještě budete muset přihlásit." FR-004 and FR-011 both doing
  exactly what they say. What is still owed is SC-003: `OnlyLocal` between two phones on one network,
  which an emulator behind a virtual router cannot prove.

  **Four defects found, all of them the interface being wrong rather than the transport:**

  * the stated size was 469x too small (the bundle's length, ignoring every document);
  * "waiting for the other phone" was false for 25 seconds, before a phrase existed to wait for;
  * the phrase wrapped mid-word, because it has no spaces and the text engine breaks anywhere;
  * **an abandoned offer left 7 MB of sealed archive in the cache.** The cleanup hangs off the send
    promise, and a send nobody ever takes up never settles, so it never ran. It now sweeps on the way
    IN as well, which bounds it however the last attempt ended, and cancelling disposes explicitly.

## Phase 5 — iOS (needs macOS)

- [ ] T022 iOS: build the xcframework with `gomobile bind -target=ios`, wire it so `nativeTransport.ts`
  stops returning unavailable on iOS, and record the IPA size before and after (SC-005) and the
  entitlement delta (SC-004). Needs macOS. *Deferred 2026-09-14 (owner decision):* transfer ships on
  Android only for now; this is built after publishing, on GitHub's macOS runners and a real iPhone.
  *Added 2026-09-15:* the Swift module has to match the Android contract: `send`/`receive` take a run
  id first, `cancel(runId)` stops only that run, and progress events carry `runId`. It also needs
  `keepScreenOn(on)`, i.e. `UIApplication.shared.isIdleTimerDisabled` set on the main thread. Until
  then `nativeTransport.keepScreenOn` is a no-op on iOS, where the feature is hidden anyway.

## Deferred, with the reason

- **Continuous sync.** 006 deferred it for 014's background argument and nothing here changes that.
  This is a transfer a user starts and watches.
- **Receiving-initiated transfer** (the new phone asks the old one). Better when the old phone is the
  damaged one; decided with the UI after the spike.
- **Self-hosted relay.** `RelayAddress` is a parameter, so this is a setting away — but a relay the
  project runs is what 006 committed not to do, and a relay the *user* runs is a feature for somebody
  who does not need this one.
