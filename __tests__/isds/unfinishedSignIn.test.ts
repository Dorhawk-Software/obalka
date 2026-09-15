// A sign-in that ends before the request that signs in (018 T007, FR-003; 001 T028).
//
// RN's native cookie jar is shared by every box and stays readable while the app is locked, which is
// why a sign-in empties it once its session is taken out. A sign-in can also end earlier: its first
// step refused or failed, an SMS asked for and no code entered, a Mobile Key push declined, timed out
// or cancelled, a status poll that failed. Each of those left its half-finished handshake's cookie in
// the jar until the next sign-in. Walked here over the real sign-in and the real transport, against a
// portal that sets its cookie on every login request - a refusal too, since nothing says it does not.

import { IsdsAuthService } from '../../src/features/accounts/state/authService';
import { LoginController } from '../../src/features/accounts/state/loginController';
import { IsdsHttpTransport } from '../../src/services/isds/isdsTransport';
import {
  TransportNetworkError,
  TransportTimeoutError,
} from '../../src/services/isds/transport';
import type { LoginErrorCode } from '../../src/services/isds/types';
import type {
  HttpClient,
  HttpRequest,
  HttpResponse,
} from '../../src/services/isds/httpClient';
import { liveSignal, makeTransport } from '../helpers/fakeTransport';

/** The native jar as a sign-in fills it: what the portal set last, until something empties it. */
class PortalJar {
  cookie: string | null = null;
  async clearAll(): Promise<void> {
    this.cookie = null;
  }
  async readSession(): Promise<string | null> {
    return this.cookie;
  }
}

/** What the portal does with a request: answer it, or fail it once its headers have arrived. */
type Answer = HttpResponse | Error;

/**
 * The portal's sign-in endpoints. Every request to `/as/processLogin` sets a handshake cookie before it
 * answers - numbered, so one sign-in's can be told from the next one's - and each status poll takes
 * the next of `polls`.
 */
class Portal implements HttpClient {
  readonly sent: HttpRequest[] = [];
  private opened = 0;
  constructor(
    private readonly jar: PortalJar,
    private readonly login: () => Answer,
    private readonly polls: Answer[] = [],
  ) {}

  async send(req: HttpRequest): Promise<HttpResponse> {
    this.sent.push(req);
    let answer: Answer;
    if (req.url.includes('/as/processLogin')) {
      this.opened += 1;
      this.jar.cookie = `S-COOKIE=${this.opened}`;
      answer = this.login();
    } else {
      answer = this.polls.shift() ?? new Error('no status poll answer left');
    }
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  }
}

/** `otpBegin`'s "SMS sent" and `mepBegin`'s "push sent" alike: a redirect. */
const accepted: HttpResponse = { status: 302, text: '', headers: {} };
const refused: HttpResponse = { status: 401, text: '' };
const pollState = (status: number): HttpResponse => ({
  status: 200,
  text: JSON.stringify({ status, description: '' }),
});

function signIn(
  login: () => Answer,
  polls: Answer[] = [],
  timing: { now?: () => number; delay?: (ms: number) => Promise<void> } = {},
) {
  const jar = new PortalJar();
  const portal = new Portal(jar, login, polls);
  const service = new IsdsAuthService({
    transport: new IsdsHttpTransport(portal, jar),
    host: 'production',
    now: timing.now ?? (() => 0),
    delay: timing.delay ?? (async () => {}),
  });
  return { jar, portal, service };
}

const sms = (signal: AbortSignal = liveSignal()) => ({
  loginName: 'novak',
  password: 'pw',
  method: 'otp_totp' as const,
  host: 'production' as const,
  signal,
});

const mobileKey = (signal: AbortSignal = liveSignal()) => ({
  loginName: 'novak',
  communicationCode: 'CODE',
  applicationName: 'Obálka',
  host: 'production' as const,
  signal,
});

describe('an SMS sign-in that ends before its code', () => {
  it.each<[string, () => Answer, LoginErrorCode]>([
    ['refused - a wrong password', () => refused, 'invalidCredentials'],
    ['failing on the way', () => new TransportNetworkError(), 'network'],
    ['timing out', () => new TransportTimeoutError(), 'timeout'],
  ])('empties the jar when the SMS request is %s', async (_, login, code) => {
    const { jar, service } = signIn(login);
    expect(await service.beginLogin(sms())).toMatchObject({ kind: 'error', code });
    expect(jar.cookie).toBeNull();
  });

  it('keeps the handshake while the code is awaited, and empties it when the person cancels', async () => {
    const { jar, portal, service } = signIn(() => accepted);
    expect(await service.beginLogin(sms())).toMatchObject({ kind: 'needsOtpSms' });
    // The code has to ride this cookie.
    expect(jar.cookie).toBe('S-COOKIE=1');

    await service.abandon();
    expect(jar.cookie).toBeNull();
    // The password kept for the code went too: a code submitted afterwards has nothing to go with.
    expect(await service.submitOtp('123456', liveSignal())).toMatchObject({
      kind: 'error',
      code: 'serverFault',
    });
    expect(portal.sent).toHaveLength(1);
  });

  it('keeps the handshake a resend opened, and empties the jar when a resend is refused', async () => {
    const answers: Answer[] = [accepted, accepted, refused];
    const { jar, service } = signIn(() => answers.shift() ?? refused);
    await service.beginLogin(sms());
    expect(await service.resendSms(liveSignal())).toEqual({ kind: 'needsOtpSms' });
    expect(jar.cookie).toBe('S-COOKIE=2');

    expect(await service.resendSms(liveSignal())).toMatchObject({
      kind: 'error',
      code: 'invalidCredentials',
    });
    expect(jar.cookie).toBeNull();
  });
});

describe('a Mobile Key sign-in that ends before its confirmation', () => {
  it.each<[string, () => Answer, LoginErrorCode]>([
    ['refused - a wrong communication code', () => refused, 'invalidCredentials'],
    ['answered with an error', () => ({ status: 500, text: '' }), 'serverFault'],
    ['failing on the way', () => new TransportNetworkError(), 'network'],
    ['timing out', () => new TransportTimeoutError(), 'timeout'],
  ])('empties the jar when its start is %s', async (_, login, code) => {
    const { jar, service } = signIn(login);
    expect(await service.mobileKeyLogin(mobileKey())).toMatchObject({ kind: 'error', code });
    expect(jar.cookie).toBeNull();
  });

  it.each<[string, Answer[], LoginErrorCode]>([
    ['a push declined in the Mobile Key app', [pollState(3)], 'mobileKeyRejected'],
    ['a push that could not be delivered', [pollState(19)], 'serverFault'],
    ['a request ISDS no longer knows', [pollState(-1)], 'serverFault'],
    ['a status poll answered with an error', [pollState(11), { status: 502, text: '' }], 'serverFault'],
    ['a status poll failing on the way', [pollState(11), new TransportNetworkError()], 'network'],
    ['a status poll timing out', [pollState(11), new TransportTimeoutError()], 'timeout'],
  ])('empties the jar after %s', async (_, polls, code) => {
    const { jar, service } = signIn(() => accepted, polls);
    expect(await service.mobileKeyLogin(mobileKey())).toMatchObject({ kind: 'error', code });
    expect(jar.cookie).toBeNull();
  });

  it('empties the jar when the 240 s approval window runs out', async () => {
    let t = 0;
    const { jar, service } = signIn(() => accepted, [pollState(1)], {
      // The first reading sets the deadline; the second is past it.
      now: () => {
        const v = t;
        t += 250_000;
        return v;
      },
    });
    expect(await service.mobileKeyLogin(mobileKey())).toMatchObject({
      kind: 'error',
      code: 'mobileKeyTimeout',
    });
    expect(jar.cookie).toBeNull();
  });

  it('empties the jar at the cancel, and the wait waking later leaves the next sign-in alone', async () => {
    // The loop a cancel aborts wakes only after its pause between polls, and by then the person may
    // have started again. Emptying the jar then would take the cookie that new attempt's first step
    // set - so the cancel itself ends the handshake.
    let wake: () => void = () => {};
    let paused: () => void = () => {};
    const pausing = new Promise<void>(resolve => {
      paused = resolve;
    });
    const { jar, service } = signIn(() => accepted, [pollState(11)], {
      delay: () => {
        paused();
        return new Promise<void>(resolve => {
          wake = resolve;
        });
      },
    });
    const attempt = new AbortController();
    const first = service.mobileKeyLogin(mobileKey(attempt.signal));
    await pausing;
    expect(jar.cookie).toBe('S-COOKIE=1');

    attempt.abort();
    await service.abandon();
    expect(jar.cookie).toBeNull();

    // Started again - with an SMS this time - before the old wait is over.
    expect(await service.beginLogin(sms())).toEqual({ kind: 'needsOtpSms' });
    wake();
    expect(await first).toMatchObject({ kind: 'error', code: 'cancelled' });
    expect(jar.cookie).toBe('S-COOKIE=2');
  });
});

// The code screen offers "send again" while the first SMS request is still out, and a cancel aborts only
// the request the controller holds - so that first request can run on, unaborted, past a resend or a new
// sign-in, and fail there.
describe('an SMS request that fails after a later step took over', () => {
  /** The portal, with its first request held open until the test fails it - a slow network. */
  function slowFirstRequest() {
    const jar = new PortalJar();
    let opened = 0;
    let failFirst: (e: Error) => void = () => {};
    let firstSent: () => void = () => {};
    const sent = new Promise<void>(resolve => {
      firstSent = resolve;
    });
    const portal: HttpClient = {
      send: () => {
        opened += 1;
        if (opened === 1) {
          firstSent();
          return new Promise<HttpResponse>((_, reject) => {
            failFirst = reject;
          });
        }
        jar.cookie = `S-COOKIE=${opened}`;
        return Promise.resolve(accepted);
      },
    };
    const service = new IsdsAuthService({
      transport: new IsdsHttpTransport(portal, jar),
      host: 'production',
    });
    return { jar, service, sent, fail: (e: Error) => failFirst(e) };
  }

  it('keeps the handshake a resend opened, which the code has to ride', async () => {
    const { jar, service, sent, fail } = slowFirstRequest();
    const first = service.beginLogin(sms());
    await sent;
    expect(await service.resendSms(liveSignal())).toEqual({ kind: 'needsOtpSms' });
    expect(jar.cookie).toBe('S-COOKIE=2');

    fail(new TransportTimeoutError());
    expect(await first).toMatchObject({ kind: 'error', code: 'timeout' });
    expect(jar.cookie).toBe('S-COOKIE=2');
  });

  it('leaves the next sign-in alone when the person cancelled after a resend and started again', async () => {
    const { jar, service, sent, fail } = slowFirstRequest();
    const controller = new LoginController({
      authService: service,
      accountsController: {} as never,
      host: 'production',
      onChange: () => {},
    });
    const credentials = {
      loginName: 'novak',
      password: 'pw',
      method: 'otp_totp' as const,
      host: 'production' as const,
    };
    const first = controller.start(credentials);
    await sent;
    await controller.resendSms();
    expect(controller.state.status).toBe('awaitingSmsCode');
    // Aborts the resend's request - not the first one, which is still out.
    controller.cancel();
    await controller.start(credentials);
    expect(controller.state.status).toBe('awaitingSmsCode');
    expect(jar.cookie).toBe('S-COOKIE=3');

    fail(new TransportTimeoutError());
    await first;
    expect(jar.cookie).toBe('S-COOKIE=3');
  });
});

describe('ending a handshake that fails', () => {
  it('still answers the sign-in, never rejects it', async () => {
    // The real transport never throws here (`resetJar` reports and carries on); a sign-in that
    // rejected because a cleanup did would be a crash on the add-box screen.
    const abandonLogin = jest.fn(async () => {
      throw new Error('no native module');
    });
    const service = new IsdsAuthService({
      transport: makeTransport({
        otpBegin: async () => ({ type: 'authFault' }),
        abandonLogin,
      }),
    });
    await expect(service.beginLogin(sms())).resolves.toMatchObject({
      kind: 'error',
      code: 'invalidCredentials',
    });
    await expect(service.abandon()).resolves.toBeUndefined();
    expect(abandonLogin).toHaveBeenCalledTimes(2);
  });
});
