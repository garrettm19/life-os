import { describe, expect, it } from '@jest/globals';
import { decodeState } from '../data';
import { emptyState, Routine, shiftDate } from '../model';
import { ensureChecklistDay, generateDay } from '../planner';
import { inRepeatWeek, onItsDays, repeatText, validateRepeat } from '../repeat';

// Synthetic routines only.
const routine = (extra: Partial<Routine> = {}): Routine => ({
  id: 'haircut',
  title: 'Example haircut',
  duration: null,
  weekdays: [6],
  preferredStart: null,
  enabled: true,
  fixed: false,
  steps: [],
  bundledInto: null,
  checklist: true,
  ...extra,
});

// Monday 2026-11-02 starts the anchor week; Saturdays follow on the 7th, 14th, 21st, 28th.
const ANCHOR = '2026-11-04';

describe('repeats every N weeks', () => {
  it('a weekly routine is unchanged', () => {
    const r = routine();
    expect(onItsDays(r, '2026-11-07')).toBe(true);
    expect(onItsDays(r, '2026-11-14')).toBe(true);
    expect(onItsDays(r, '2026-11-13')).toBe(false);
    expect(repeatText(r)).toBeNull();
  });

  it('comes up every third week counted from the anchor week, before and after it', () => {
    const r = routine({ repeat: { everyWeeks: 3, anchor: ANCHOR } });
    const saturdays = Array.from({ length: 8 }, (_, i) => shiftDate('2026-10-17', i * 7));
    expect(saturdays.map((d) => onItsDays(r, d))).toEqual([
      true, // Oct 17: three weeks before the anchor week
      false,
      false,
      true, // Nov 7: the anchor week
      false,
      false,
      true, // Nov 28
      false,
    ]);
    expect(repeatText(r)).toBe('Every 3 weeks');
  });

  it('counts whole weeks across daylight-saving changes and a year end', () => {
    const r = routine({ weekdays: [0], repeat: { everyWeeks: 2, anchor: '2026-03-02' } });
    // US clocks change on March 8 and November 1, 2026; the pattern never drifts.
    const sundays = Array.from({ length: 60 }, (_, i) => shiftDate('2026-03-08', i * 7));
    sundays.forEach((d, i) => expect(inRepeatWeek(r, d)).toBe(i % 2 === 0));
  });

  it('places the occurrence only in its weeks, on Today and in generated days', () => {
    const r = routine({ repeat: { everyWeeks: 2, anchor: ANCHOR } });
    const programs = [{ id: 'p', title: 'Example', group: 'Weekly', goalIds: [], routines: [r] }];
    const on = ensureChecklistDay('2026-11-07', emptyState().settings, programs);
    const off = ensureChecklistDay('2026-11-14', emptyState().settings, programs);
    expect(on.blocks.map((b) => b.routineId)).toEqual(['haircut']);
    expect(off.blocks).toEqual([]);
    const timed = routine({
      checklist: false,
      duration: 30,
      repeat: { everyWeeks: 2, anchor: ANCHOR },
    });
    const timedPrograms = [{ ...programs[0], routines: [timed] }];
    expect(generateDay('2026-11-14', emptyState().settings, timedPrograms).blocks).toEqual([]);
    expect(
      generateDay('2026-11-21', emptyState().settings, timedPrograms).blocks.map(
        (b) => b.routineId,
      ),
    ).toEqual(['haircut']);
  });

  it('is validated where it is stored or imported', () => {
    expect(() => validateRepeat(undefined, {})).not.toThrow();
    expect(() =>
      validateRepeat({ everyWeeks: 2, anchor: ANCHOR }, { bundledInto: null }),
    ).not.toThrow();
    for (const bad of [
      { everyWeeks: 0, anchor: ANCHOR },
      { everyWeeks: 13, anchor: ANCHOR },
      { everyWeeks: 1.5, anchor: ANCHOR },
      { everyWeeks: 2, anchor: 'soon' },
      null,
      'weekly',
    ])
      expect(() => validateRepeat(bad, {})).toThrow();
    expect(() => validateRepeat({ everyWeeks: 2, anchor: ANCHOR }, { bundledInto: 'gym' })).toThrow(
      'bundled',
    );
    expect(() => validateRepeat({ everyWeeks: 2, anchor: ANCHOR }, { study: {} })).toThrow('study');
    const state = emptyState();
    state.programs = [
      {
        id: 'p',
        title: 'Example',
        group: 'Weekly',
        goalIds: [],
        routines: [routine({ repeat: { everyWeeks: 3, anchor: ANCHOR } })],
      },
    ];
    expect(decodeState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    state.programs[0].routines[0].repeat = { everyWeeks: 99, anchor: ANCHOR };
    expect(() => decodeState(JSON.parse(JSON.stringify(state)))).toThrow(
      'Repeat every 1 to 12 weeks.',
    );
  });
});
