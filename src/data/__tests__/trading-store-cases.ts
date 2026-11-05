import { expect, test } from '@jest/globals';
import { newSession } from '../../domain/trading';

// The trading sessions earlier builds kept on the device, on both platforms: read once, every
// record by its date with its text exactly as stored (one that cannot be read included, for the
// move to keep verbatim), other keys ignored, and nothing written or deleted. Saving and refusing
// an invalid session are the saved data's (`putTradingSession`). Synthetic sessions only.
const DAY = '2026-10-20';
const AT = '2026-10-20T13:30:00.000Z';

type Store = { readDeviceSessions: () => Promise<[string, string][]> };

/** The cases both stores keep; `put` stores a value under a key, `all` lists what is stored. */
export function tradingStoreCases(
  store: Store,
  put: (key: string, raw: string) => void,
  all: () => [string, string][],
): void {
  test('reads nothing stored as no records', async () => {
    await expect(store.readDeviceSessions()).resolves.toEqual([]);
  });

  test('reads every session record with its date and its text as stored', async () => {
    const older = JSON.stringify({ ...newSession(DAY), bias: 'bearish', biasAt: AT });
    const unreadable = '{not json';
    put(`life-os-trading-session:${DAY}`, older);
    put('life-os-trading-session:2026-10-21', unreadable);
    put('life-os-active-study:2026-10-20:study', '{}');
    put('life-os-v1', '{}');
    const before = all();
    const read = await store.readDeviceSessions();
    expect(read.sort()).toEqual([
      [DAY, older],
      ['2026-10-21', unreadable],
    ]);
    // Nothing is written or deleted.
    expect(all()).toEqual(before);
  });
}
