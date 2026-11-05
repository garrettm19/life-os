import { expect, test } from '@jest/globals';
import {
  afterRestore,
  backupName,
  checkJsonSize,
  encodeBackup,
  MAX_BACKUP_BYTES,
  parseBackup,
  restoredState,
} from '../backup';
import { State } from '../model';
import { liveTradingOn } from '../trading-live';
import { LIVE, ROUTINE, liveState } from '../../test-support/trading-live';
import { basicState } from '../../test-support/basic-state';
import { generateDay, makeBlock, replanDay, setStatus } from '../planner';

const createdAt = '2026-10-04T23:30:00.000Z';
function recordedState() {
  const state = basicState();
  state.notes = ['Synthetic note with Unicode: café 🌿'];
  const day = generateDay('2026-11-09', state.settings, state.programs);
  state.days[day.date] = replanDay(setStatus(day, day.blocks[0].id, 'done'), state.settings, 720);
  return state;
}
test('a versioned backup round-trips goals, routines, settings, completions and revision history', () => {
  const state = recordedState();
  const parsed = parseBackup(encodeBackup(state, createdAt));
  expect(parsed.createdAt).toBe(createdAt);
  expect(parsed.state).toEqual(state);
  expect(parsed.state).not.toBe(state);
  // Replan is a plan change and keeps its snapshot; the Done before it saves none.
  expect(parsed.state.days['2026-11-09'].revisions.map((r) => r.reason)).toEqual([
    'Replan future flexible blocks',
  ]);
});
test('rejects truncated JSON, setup files and unknown backup/schema versions', () => {
  expect(() => parseBackup('{bad')).toThrow(/not valid JSON/);
  const backup = JSON.parse(encodeBackup(recordedState(), createdAt));
  for (const changed of [
    { ...backup, format: 'life-os-setup-v1' },
    // Unknown future versions, and a format whose state version does not match it.
    { ...backup, version: 6 },
    { ...backup, state: { ...backup.state, version: 6 } },
    { ...backup, version: 4 },
    { ...backup, state: { ...backup.state, version: 4 } },
    { ...backup, version: 3 },
    { ...backup, state: { ...backup.state, version: 3 } },
    { ...backup, version: 2 },
    { ...backup, state: { ...backup.state, version: 2 } },
    { ...backup, version: 1 },
    { ...backup, state: { ...backup.state, version: 1 } },
    { ...backup, createdAt: 'not-a-time' },
    {
      ...backup,
      state: { ...backup.state, programs: [backup.state.programs[0], backup.state.programs[0]] },
    },
    { ...backup, state: { ...backup.state, settings: { ...backup.state.settings, wake: 1400 } } },
  ])
    expect(() => parseBackup(JSON.stringify(changed))).toThrow();
});
test('rejects malformed history and overlapping active intervals before restore', () => {
  const state = recordedState();
  const day = state.days['2026-11-09'];
  day.revisions[0].at = 'invalid';
  expect(() => encodeBackup(state, createdAt)).toThrow(/timestamp/);
  day.revisions[0].at = createdAt;
  day.revisions[0].blocks.push(day.revisions[0].blocks[0]);
  expect(() => encodeBackup(state, createdAt)).toThrow(/duplicate historical/);
  day.revisions[0].blocks.pop();
  day.blocks.push(makeBlock('conflict', 'Synthetic conflict', 600, 15));
  expect(() => encodeBackup(state, createdAt)).toThrow(/overlapping/);
});
test('byte bounds count Unicode correctly and reject oversized input before parsing', () => {
  expect(() => checkJsonSize('aé🌿', 7, 'backup')).not.toThrow();
  expect(() => checkJsonSize('aé🌿', 6, 'backup')).toThrow(/under/);
  expect(() => parseBackup(' '.repeat(MAX_BACKUP_BYTES + 1))).toThrow(/20 MB/);
});
test('restore rejects structurally invalid days before anything can be replaced', () => {
  const backup = JSON.parse(encodeBackup(recordedState(), createdAt));
  const date = '2026-11-09';
  const day = backup.state.days[date];
  const withDay = (changed: object) => ({
    ...backup,
    state: { ...backup.state, days: { ...backup.state.days, [date]: { ...day, ...changed } } },
  });
  const cases: [object, RegExp][] = [
    [withDay({ date: '2026-11-10' }), /Invalid day/],
    [withDay({ blocks: [{ ...day.blocks[0], status: 'finished' }] }), /./],
    [withDay({ blocks: [day.blocks[0], day.blocks[0]] }), /Duplicate occurrence/],
    [withDay({ protection: { reason: 'boredom', at: createdAt } }), /protection/],
    [withDay({ protection: { reason: 'travel', at: 'yesterday' } }), /protection/],
    [withDay({ dueTimed: ['strength-1', 'strength-1'] }), /due timed/],
  ];
  for (const [changed, message] of cases)
    expect(() => parseBackup(JSON.stringify(changed))).toThrow(message);
});
test('an export over the size limit explains itself instead of asking for a smaller file', () => {
  const state = recordedState();
  const day = state.days['2026-11-09'];
  const padded = {
    ...day,
    revisions: Array.from({ length: 5000 }, (_, i) => ({
      at: createdAt,
      reason: `Synthetic revision ${i}`,
      blocks: day.blocks.map((block) => ({ ...block, steps: ['x'.repeat(1000)] })),
    })),
  };
  const large = { ...state, days: { ...state.days, [day.date]: padded } };
  expect(() => encodeBackup(large, createdAt)).toThrow(/larger than the 20 MB backup limit/);
});

test('a backup file is named by its local date and time, in the LifeOS-backup-*.json pattern', () => {
  expect(backupName(new Date(2026, 9, 15, 8, 0))).toBe('LifeOS-backup-2026-10-15-0800.json');
  expect(backupName(new Date(2026, 0, 5, 23, 7))).toBe('LifeOS-backup-2026-01-05-2307.json');
  expect(backupName(new Date(2026, 0, 5, 0, 30))).toMatch(/^LifeOS-backup-.*\.json$/);
});
test('a restore brings back the trading profile with live trading off, like the widget opt-in', () => {
  const live = liveState(LIVE);
  const profile = (s: State) => s.ruleBooks.find((b) => b.routineId === ROUTINE)!.trading!;
  expect(liveTradingOn(profile(live))).toBe(true);
  const raw = encodeBackup(live, createdAt);
  // The file never carries the switch.
  const file = JSON.parse(raw);
  expect(
    file.state.ruleBooks.find((b: { routineId: string }) => b.routineId === ROUTINE).trading,
  ).not.toHaveProperty('liveTrading');
  const restored = restoredState(parseBackup(raw));
  expect(liveTradingOn(profile(restored))).toBe(false);
  // Everything else on the profile comes back as it was.
  const { liveTrading: _on, ...rest } = profile(live);
  expect(profile(restored)).toEqual(rest);
  // A file written before this rule, still carrying the switch, restores with it off too.
  file.state.ruleBooks = live.ruleBooks;
  expect(liveTradingOn(profile(restoredState(parseBackup(JSON.stringify(file)))))).toBe(false);
});
test('after a restore, one list says what the backup cannot bring back', () => {
  const steps = afterRestore(liveState());
  expect(steps).toEqual([
    'Add the Life OS widgets to your Home Screen and Lock Screen again if they are gone.',
    "The widget's Day Cleared status is off: turn it on in Settings if you want it.",
    "After a reinstall or on a new phone, allow notifications for Life OS in the iPhone's Settings so reminders arrive.",
    'Live trading is off: turn it on again in Your limits if you trade live. It asks the money question again, and for a live account you already trade, its confirmation.',
  ]);
  // Without a trading rulebook, live trading is not mentioned.
  expect(afterRestore(basicState())).toEqual(steps.slice(0, 3));
});
