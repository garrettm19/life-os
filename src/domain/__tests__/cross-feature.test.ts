import { describe, expect, it } from '@jest/globals';
import { recordActivity } from '../activity';
import { parseSetup } from '../data';
import { buildExport, encodeCsv } from '../export';
import { Program, State } from '../model';
import { ensureDay, setRotation } from '../rotation';
import { upsertRoutine } from '../routines';
import { trainingState } from '../../test-support/fixtures';

// Behaviour that spans setup import, rotations, companions and export.
const MON = '2026-11-09';
const AT = new Date(2026, 10, 9, 12).toISOString();

function rotating(): State {
  const base = trainingState();
  const training = base.programs.find((p) => p.id === 'training')!;
  const withCompanion: Program = {
    ...training,
    routines: [
      ...training.routines,
      {
        id: 'home',
        title: 'Home routine',
        duration: null,
        weekdays: [],
        preferredStart: null,
        enabled: true,
        fixed: false,
        steps: ['One'],
        bundledInto: null,
        checklist: true,
        follows: ['upper'],
      },
    ],
  };
  const state = {
    ...base,
    programs: base.programs.map((p) => (p.id === 'training' ? withCompanion : p)),
  };
  return setRotation(
    state,
    'training',
    { order: ['upper', 'lower'], restDays: [0], startWith: null },
    AT,
  );
}

/** The training program as an older setup file describes it: weekday workouts, no rotation. */
const olderSetup = (state: State) =>
  JSON.stringify({
    format: 'life-os-setup-v1',
    goals: state.goals,
    programs: [
      {
        ...trainingState().programs.find((p) => p.id === 'training')!,
        routines: [
          ...trainingState().programs.find((p) => p.id === 'training')!.routines,
          { ...state.programs.find((p) => p.id === 'training')!.routines[2], follows: undefined },
        ],
      },
    ],
  });

describe('cross-feature behavior', () => {
  it('re-importing an older setup keeps the in-app rotation and routine settings', () => {
    const state = rotating();
    const result = parseSetup(olderSetup(state), state, AT);
    const training = result.programs.find((p) => p.id === 'training')!;
    expect(training.rotation).toEqual(state.programs.find((p) => p.id === 'training')!.rotation);
    // Rotation workouts stay checklist objectives without weekdays, so they are never also due by
    // weekday as timed sessions.
    for (const id of ['upper', 'lower'])
      expect(training.routines.find((r) => r.id === id)).toMatchObject({
        checklist: true,
        weekdays: [],
      });
    expect(training.routines.find((r) => r.id === 'home')!.follows).toEqual(['upper']);
  });

  it('refuses a setup whose rotation workout is also a companion', () => {
    const state = rotating();
    const training = state.programs.find((p) => p.id === 'training')!;
    const raw = JSON.stringify({
      format: 'life-os-setup-v1',
      goals: state.goals,
      programs: [
        {
          ...training,
          routines: training.routines.map((r) =>
            r.id === 'upper' ? { ...r, follows: ['home'] } : r,
          ),
        },
      ],
    });
    expect(() => parseSetup(raw, state, AT)).toThrow(/cannot also be in the rotation/);
  });

  it('editing a companion reaches its planned occurrence today', () => {
    let state = ensureDay(rotating(), MON, AT);
    expect(state.days[MON].blocks.find((b) => b.routineId === 'home')!.optional).toBeUndefined();
    const training = state.programs.find((p) => p.id === 'training')!;
    const home = training.routines.find((r) => r.id === 'home')!;
    state = upsertRoutine(
      state,
      training,
      { ...home, title: 'Home routine (short)', optional: true },
      AT,
    );
    expect(state.days[MON].blocks.find((b) => b.routineId === 'home')).toMatchObject({
      title: 'Home routine (short)',
      optional: true,
    });
  });

  it("export leaves a private routine's activities out unless private routines are included", () => {
    let state = trainingState();
    const tracking = state.programs.find((p) => p.id === 'tracking')!;
    state = {
      ...state,
      programs: state.programs.map((p) =>
        p.id === 'tracking'
          ? {
              ...p,
              routines: [
                ...tracking.routines,
                {
                  ...tracking.routines[0],
                  id: 'secret-cardio',
                  title: 'Private activity',
                  capture: 'activity' as const,
                  private: true,
                },
              ],
            }
          : p,
      ),
    };
    state = recordActivity(
      state,
      { date: MON, activity: '=SUM(1)', minutes: 20, note: '', routineId: 'secret-cardio' },
      'a1',
      AT,
    );
    const base = { categories: ['activities' as const], from: null, to: MON };
    expect(buildExport(state, { ...base, includePrivate: false })).toEqual([]);
    expect(buildExport(state, { ...base, includePrivate: true })).toHaveLength(1);
    // A cell that would start a spreadsheet formula is written as text.
    expect(encodeCsv(state, { ...base, includePrivate: true })).toContain(",'=SUM(1),minutes,20,");
  });
});
