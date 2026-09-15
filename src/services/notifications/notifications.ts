// Local notifications boundary (feature 010 US2). Reminder scheduling ONLY.
//
// This file existed before, with three methods, and 014 deleted it. Read that spec before adding
// anything here, because the deletion was not a cleanup - it was the conclusion of a compliance
// argument. Every ISDS call is a sign-in, and Provozní řád ISDS §17 requires an application installed
// on a local station to sign in "pomocí manuálního příkazu uživatele". The app therefore runs NO code
// while it is closed and cannot learn that anything has happened.
//
// A reminder is different in kind: the user picked a date, the OS holds the timer, and nothing talks
// to ISDS. That is why this boundary may exist again, and it is also the exact shape of what it may
// contain.
//
// WHAT THIS INTERFACE MUST NOT GROW (010 FR-010):
//
//   * no `notifyNewMessages`, or anything triggered by mail arriving - the app cannot know that;
//   * no method taking a `DataBoxAccount`, a transport, a sync result, or a message list;
//   * no scheduling primitive that is not tied to a date the user chose.
//
// If a change seems to need one of those, it is not a notification change - it is a background-sync
// change, and `specs/014-no-background-sync/spec.md` is the document to argue with first.

/** What a scheduled reminder needs in order to be shown and cancelled. */
export interface ScheduleReminderInput {
  boxId: string;
  messageId: string;
  /** Shown in the notification body. Null when the message has no subject. */
  subject: string | null;
  /** Epoch ms for each timer, or null when that moment has already passed. */
  timers: { dayBefore: number | null; onDay: number | null };
}

export interface Notifier {
  /**
   * Ask for OS notification permission. Call it when the user sets their FIRST reminder - not on
   * launch, and not before they have asked for anything. Never throws; resolves whether allowed.
   */
  requestPermission(): Promise<boolean>;
  /**
   * Schedule (or reschedule) both timers for one reminder. Timers already in the past are skipped.
   *
   * BEST-EFFORT by contract: a scheduling failure MUST NOT propagate. The chip and the attention
   * group are the primary signal and the notification is the bonus (010 FR-006) - a user who denied
   * permission still gets a working reminder, just a silent one.
   */
  scheduleReminder(input: ScheduleReminderInput): Promise<void>;
  /** Cancel both timers. Idempotent - safe for a reminder that was never scheduled. */
  cancelReminder(boxId: string, messageId: string): Promise<void>;
}

/** Records calls instead of scheduling anything - for tests and previews. */
export class InMemoryNotifier implements Notifier {
  scheduled: ScheduleReminderInput[] = [];
  cancelled: { boxId: string; messageId: string }[] = [];
  permission = true;

  async requestPermission(): Promise<boolean> {
    return this.permission;
  }

  async scheduleReminder(input: ScheduleReminderInput): Promise<void> {
    this.scheduled.push(input);
  }

  async cancelReminder(boxId: string, messageId: string): Promise<void> {
    this.cancelled.push({ boxId, messageId });
  }
}
