import { describe, expect, it } from '@jest/globals';
import { recordActivity } from '../activity';
import { encodeBackup, parseBackup } from '../backup';
import { withDay } from '../data';
import { CORE_CIRCUIT, completeCircuit, newCircuit, saveCircuit } from '../intervals';
import { Program, State } from '../model';
import { restorePreview } from '../restore-preview';
import { parseRules, saveRuleBook, saveRuleReview } from '../rules';
import { trainingState } from '../../test-support/fixtures';

// Version-3 backups: every new record type round-trips, the restore preview counts what would be
// lost by ID, and device-only choices stay off after a restore.
const DAY = '2026-11-09';
const at = (h: number) => new Date(2026, 10, 9, h).toISOString();

function full(): State {
  let s = trainingState();
  const extra: Program = {
    id: 'extra',
    title: 'Extra',
    group: 'Daily',
    goalIds: [],
    routines: (['abs', 'cardio', 'rules'] as const).map((id) => ({
      id,
      title: id,
      duration: null,
      weekdays: [1],
      preferredStart: null,
      enabled: true,
      fixed: false,
      steps: [],
      bundledInto: null,
      checklist: true,
      ...(id === 'cardio' && { capture: 'activity' as const }),
      ...(id === 'rules' && { capture: 'rules' as const, private: true }),
    })),
  };
  s = {
    ...s,
    programs: [...s.programs, extra],
    settings: { ...s.settings, widgetDayStatus: true },
  };
  s = saveCircuit(s, newCircuit('abs', 'Core', CORE_CIRCUIT, 'c1', at(9)));
  s = withDay(s, {
    date: DAY,
    revisions: [],
    blocks: [
      {
        id: `${DAY}:routine:abs`,
        routineId: 'abs',
        programId: 'extra',
        title: 'Core',
        start: null,
        duration: null,
        fixed: false,
        status: 'planned',
        actualAt: null,
        steps: [],
        reason: null,
        checklist: true,
      },
    ],
  });
  s = completeCircuit(s, {
    intervalId: 'c1',
    date: DAY,
    blockId: `${DAY}:routine:abs`,
    startedAt: at(10),
    finishedAt: at(11),
    skipped: [],
  });
  s = recordActivity(
    s,
    { date: DAY, activity: 'Bike', minutes: 25, note: '', routineId: 'cardio' },
    'a1',
    at(12),
  );
  s = saveRuleBook(s, {
    id: 'b1',
    routineId: 'rules',
    title: 'Rules',
    checkpoints: [{ id: 'checkpoint-1', text: 'Planned first' }],
    rules: parseRules('1. Plan first'),
    updatedAt: at(9),
  });
  return saveRuleReview(
    s,
    { date: DAY, routineId: 'rules', outcome: 'none', answers: [], violations: [], note: '' },
    'r1',
    at(13),
  );
}

describe('version-3 backups', () => {
  it('round-trip every record type; the widget disclosure stays off after a restore', () => {
    const state = full();
    const raw = encodeBackup(state, at(14));
    expect(JSON.parse(raw)).toMatchObject({ format: 'life-os-backup', version: 5 });
    const restored = parseBackup(raw);
    expect(restored.sourceVersion).toBe(5);
    for (const key of [
      'intervalRoutines',
      'intervalSessions',
      'activitySessions',
      'ruleBooks',
      'ruleReviews',
      'workoutSessions',
      'measurements',
    ] as const)
      expect(restored.state[key]).toEqual(state[key]);
    // The opt-in to show day status on the Home Screen is a device choice, never restored.
    expect(restored.state.settings.widgetDayStatus).toBeUndefined();
    // Private routines stay private.
    expect(
      restored.state.programs.find((p) => p.id === 'extra')!.routines.find((r) => r.id === 'rules')!
        .private,
    ).toBe(true);
  });

  it('the restore preview lists, by ID, every version-3 record a restore would remove', () => {
    const current = full();
    const older = trainingState();
    // Label, records removed, records held now.
    const removals = restorePreview(current, older).changes.map((c) => [
      c.label,
      c.removed,
      c.current,
    ]);
    expect(removals).toEqual(
      expect.arrayContaining([
        ['circuit sessions', 1, 1],
        ['timed circuits', 1, 1],
        ['activities', 1, 1],
        ['rule reviews', 1, 1],
        ['rulebooks', 1, 1],
      ]),
    );
    // The same number of different records still counts as a loss.
    const swapped = {
      ...current,
      activitySessions: [{ ...current.activitySessions[0], id: 'other' }],
    };
    expect(restorePreview(current, swapped).changes).toEqual([
      { label: 'activities', current: 1, added: 1, removed: 1, replaced: 0 },
    ]);
    expect(restorePreview(current, current).unchanged).toBe(true);
  });

  it('a newer backup is refused before anything is read', () => {
    const raw = JSON.parse(encodeBackup(full(), at(14)));
    expect(() => parseBackup(JSON.stringify({ ...raw, version: 6 }))).toThrow(/version 1 to 5/);
    expect(() =>
      parseBackup(JSON.stringify({ ...raw, state: { ...raw.state, version: 6 } })),
    ).toThrow();
  });
});
