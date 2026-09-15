// Jest mock for @op-engineering/op-sqlite. The native SQLCipher engine can't run under jest, so the
// SqliteAccountsStore is verified on-device; here `open()` returns a no-op DB whose queries resolve
// empty, which is enough for screens that read the (empty) account list to mount.
const emptyResult = { rows: [], rowsAffected: 0 };

module.exports = {
  open: jest.fn(() => ({
    execute: jest.fn(async () => emptyResult),
    executeSync: jest.fn(() => emptyResult),
    close: jest.fn(),
  })),
};
