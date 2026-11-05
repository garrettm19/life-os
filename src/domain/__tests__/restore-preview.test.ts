import { describe, expect, it } from '@jest/globals';
import { encodeBackup, parseBackup } from '../backup';
import { demoState } from '../demo';
import { State } from '../model';
import { changeLine, restorePreview } from '../restore-preview';
import { LIVE, liveState } from '../../test-support/trading-live';

// Synthetic: the fictional demo as this device, and backups made from changed copies of it.
const TODAY = '2026-11-09';
const AT = new Date(2026, 10, 9, 12).toISOString();
const device = (): State => ({ ...demoState(TODAY), source: 'personal' });
const of = (preview: ReturnType<typeof restorePreview>, label: string) =>
  preview.changes.find((c) => c.label === label);

describe('the restore preview', () => {
  it('finds nothing to change in a backup of this exact data', () => {
    const current = device();
    const backup = parseBackup(encodeBackup(current, AT)).state;
    expect(restorePreview(current, backup)).toEqual({
      changes: [],
      settingsChanged: false,
      notesChanged: false,
      widgetTurnsOff: false,
      liveTurnsOff: false,
      unchanged: true,
    });
  });

  it('does not count the time of the last export as a settings difference', () => {
    // A backup never carries that time, while the device keeps it after an export or a restore.
    const current = device();
    current.settings = { ...current.settings, lastBackupAt: AT };
    const backup = parseBackup(encodeBackup(current, AT)).state;
    expect(backup.settings.lastBackupAt).toBeUndefined();
    expect(restorePreview(current, backup)).toMatchObject({
      settingsChanged: false,
      unchanged: true,
    });
  });

  it('counts records with the same ID but older content as replaced', () => {
    const current = device();
    const day = Object.keys(current.days).sort()[10];
    const older: State = {
      ...current,
      days: {
        ...current.days,
        [day]: {
          ...current.days[day],
          blocks: current.days[day].blocks.map((b) => ({
            ...b,
            status: 'planned',
            actualAt: null,
          })),
        },
      },
      measurements: current.measurements.map((m, i) =>
        i === 0 ? { ...m, grams: m.grams + 900 } : m,
      ),
    };
    const preview = restorePreview(current, older);
    expect(of(preview, 'planned days')).toMatchObject({ replaced: 1, removed: 0, added: 0 });
    expect(of(preview, 'weights')).toMatchObject({ replaced: 1, removed: 0, added: 0 });
    expect(preview.unchanged).toBe(false);
  });

  it('counts records the backup lacks as removed, and records only in the backup as added', () => {
    const current = device();
    const backup: State = {
      ...current,
      moneyReviews: current.moneyReviews.slice(2),
      goals: [],
      measurements: [
        ...current.measurements,
        { ...current.measurements[0], id: 'w-extra', date: '2026-09-01' },
      ],
    };
    const preview = restorePreview(current, backup);
    expect(of(preview, 'money reviews')).toMatchObject({ removed: 2, added: 0, replaced: 0 });
    expect(of(preview, 'goals')).toMatchObject({ removed: current.goals.length });
    expect(of(preview, 'weights')).toMatchObject({ added: 1, removed: 0, replaced: 0 });
    // Kinds that would not change are not listed.
    expect(of(preview, 'workout logs')).toBeUndefined();
  });

  it('reports changed settings and notes, and the widget day status turning off', () => {
    const current = device();
    const here: State = { ...current, settings: { ...current.settings, widgetDayStatus: true } };
    const backup: State = {
      ...current,
      settings: { ...current.settings, wake: current.settings.wake + 30 },
      notes: ['A synthetic note'],
    };
    const preview = restorePreview(here, backup);
    expect(preview).toMatchObject({
      settingsChanged: true,
      notesChanged: true,
      widgetTurnsOff: true,
    });
    // The widget opt-in alone is not a settings difference: backups never carry it.
    const same = restorePreview(here, parseBackup(encodeBackup(here, AT)).state);
    expect(same).toMatchObject({ settingsChanged: false, widgetTurnsOff: true, unchanged: true });
  });

  it('reports live trading turning off, without counting the switch as a rulebook change', () => {
    const here = liveState(LIVE);
    const same = restorePreview(here, parseBackup(encodeBackup(here, AT)).state);
    expect(same).toMatchObject({ liveTurnsOff: true, unchanged: true, changes: [] });
    // A device with live trading switched off has nothing to turn off.
    const off = liveState({ ...LIVE, liveTrading: false });
    expect(restorePreview(off, parseBackup(encodeBackup(here, AT)).state)).toMatchObject({
      liveTurnsOff: false,
      unchanged: true,
    });
  });

  it('does not count a record as replaced when only its key order differs', () => {
    const current = device();
    const reordered: State = {
      ...current,
      measurements: current.measurements.map(
        (m) => Object.fromEntries(Object.entries(m).reverse()) as typeof m,
      ),
    };
    expect(restorePreview(current, reordered).unchanged).toBe(true);
  });

  it('describes changes with labels and counts only, never values', () => {
    const current = device();
    const backup: State = {
      ...current,
      moneyReviews: current.moneyReviews.map((r, i) => (i === 0 ? { ...r, debt: 1 } : r)),
      measurements: current.measurements.slice(1),
    };
    const lines = restorePreview(current, backup).changes.map(changeLine);
    expect(lines).toEqual([
      `weights: 1 removed (you have ${current.measurements.length})`,
      `money reviews: 1 replaced by the backup's version (you have ${current.moneyReviews.length})`,
    ]);
    for (const line of lines) expect(line).not.toMatch(/\$|lb|kg|\./);
  });
});
