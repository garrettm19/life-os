import { describe, expect, it } from '@jest/globals';
import { backupReminder, daysSinceBackup, lastBackupText } from '../backup-reminder';
import { decodeState } from '../data';
import { encodeBackup, parseBackup, restoredState } from '../backup';
import { emptyState, shiftDate, State } from '../model';

// Synthetic days only. Clocks are built from local dates, never UTC instants.
const NOW = new Date(2026, 9, 20, 9);
const TODAY = '2026-10-20';

function recorded(count: number): State {
  const state = emptyState();
  state.source = 'personal';
  for (let i = 1; i <= count; i++) {
    const date = shiftDate(TODAY, -i);
    state.days[date] = {
      date,
      blocks: [
        {
          id: `${date}:a`,
          title: 'Example walk',
          start: null,
          end: null,
          status: 'done',
          routineId: null,
        },
      ],
    } as unknown as State['days'][string];
  }
  return state;
}

const at = (daysAgo: number) => new Date(2026, 9, 20 - daysAgo, 12).toISOString();

describe('backup reminder', () => {
  it('stays quiet until a week of days is recorded, and never in the demo', () => {
    expect(backupReminder(recorded(6), NOW)).toBeNull();
    expect(backupReminder(recorded(7), NOW)).toBe(
      'No backup yet: export one to keep your history safe.',
    );
    expect(backupReminder({ ...recorded(10), source: 'demo' }, NOW)).toBeNull();
  });

  it('asks again only after two weeks without an export', () => {
    const state = recorded(30);
    state.settings.lastBackupAt = at(13);
    expect(backupReminder(state, NOW)).toBeNull();
    state.settings.lastBackupAt = at(14);
    expect(backupReminder(state, NOW)).toBe('Last backup 14 days ago: export a fresh one.');
  });

  it('describes the last backup for Settings', () => {
    const state = emptyState();
    expect(lastBackupText(state, NOW)).toBe('Never');
    expect(daysSinceBackup(state, NOW)).toBeNull();
    state.settings.lastBackupAt = at(0);
    expect(lastBackupText(state, NOW)).toBe('Today');
    state.settings.lastBackupAt = at(1);
    expect(lastBackupText(state, NOW)).toBe('Yesterday');
    state.settings.lastBackupAt = at(5);
    expect(lastBackupText(state, NOW)).toBe('5 days ago');
  });

  it('is stored and validated; a backup never carries it, and a restore records that backup', () => {
    const state = emptyState();
    state.settings.lastBackupAt = at(3);
    expect(decodeState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(() =>
      decodeState({ ...state, settings: { ...state.settings, lastBackupAt: 'soon' } }),
    ).toThrow();
    const createdAt = at(1);
    const raw = encodeBackup(state, createdAt);
    expect(JSON.parse(raw).state.settings.lastBackupAt).toBeUndefined();
    expect(parseBackup(raw).state.settings.lastBackupAt).toBeUndefined();
    expect(restoredState(parseBackup(raw)).settings.lastBackupAt).toBe(createdAt);
  });
});
