import { describe, expect, it } from '@jest/globals';
import { occurrenceText, variantIndex } from '../alternation';
import { decodeState, withDay } from '../data';
import { Program, Routine, State, shiftDate } from '../model';
import { ensureChecklistDay } from '../planner';
import { upsertRoutine } from '../routines';
import { trainingState } from '../../test-support/fixtures';

// A synthetic daily routine alternating two variants, anchored on a Monday.
const ANCHOR = '2026-11-09';
const noon = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
};

const mobility: Routine = {
  id: 'mobility',
  title: 'Mobility',
  duration: null,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  preferredStart: null,
  enabled: true,
  fixed: false,
  steps: [],
  bundledInto: null,
  checklist: true,
  alternate: {
    anchor: ANCHOR,
    variants: [
      { title: 'Upper', steps: ['Stretch one', 'Stretch two'] },
      { title: 'Lower', steps: ['Stretch three'] },
    ],
  },
  links: [{ label: 'Reference', url: 'https://example.com/mobility' }],
};

function state(): State {
  const base = trainingState();
  const program: Program = {
    id: 'daily',
    title: 'Daily',
    group: 'Daily',
    goalIds: [],
    routines: [mobility],
  };
  return { ...base, programs: [...base.programs, program] };
}
const open = (s: State, date: string) =>
  withDay(s, ensureChecklistDay(date, s.settings, s.programs, s.days[date], noon(date)));
const title = (s: State, date: string) =>
  s.days[date].blocks.find((b) => b.routineId === 'mobility')!.title;

describe('daily alternation', () => {
  it('follows the calendar from the anchor, also before it and across clock changes', () => {
    expect(variantIndex(mobility, ANCHOR)).toBe(0);
    expect(variantIndex(mobility, shiftDate(ANCHOR, 1))).toBe(1);
    expect(variantIndex(mobility, shiftDate(ANCHOR, -1))).toBe(1);
    expect(variantIndex(mobility, shiftDate(ANCHOR, -2))).toBe(0);
    // Across the 2027 US spring change, 120 days later, the parity still holds.
    expect(variantIndex(mobility, shiftDate(ANCHOR, 120))).toBe(0);
    expect(variantIndex({ ...mobility, alternate: undefined }, ANCHOR)).toBeNull();
    expect(occurrenceText(mobility, shiftDate(ANCHOR, 1))).toEqual({
      title: 'Mobility · Lower',
      steps: ['Stretch three'],
    });
  });

  it('a missed day never shifts the pattern or leaves anything owed', () => {
    let s = open(state(), ANCHOR);
    expect(title(s, ANCHOR)).toBe('Mobility · Upper');
    // The next two days are never opened; the fourth day takes its own variant.
    const later = shiftDate(ANCHOR, 3);
    s = open(s, later);
    expect(title(s, later)).toBe('Mobility · Lower');
    expect(s.days[later].blocks.find((b) => b.routineId === 'mobility')!.steps).toEqual([
      'Stretch three',
    ]);
    expect(s.days[shiftDate(ANCHOR, 1)]).toBeUndefined();
  });

  it('editing the variants updates today and later, never a recorded past day', () => {
    let s = open(state(), ANCHOR);
    const tomorrow = shiftDate(ANCHOR, 1);
    s = open(s, tomorrow);
    const daily = s.programs.find((p) => p.id === 'daily')!;
    const edited: Routine = {
      ...mobility,
      alternate: {
        anchor: ANCHOR,
        variants: [
          { title: 'Shoulders', steps: ['A'] },
          { title: 'Hips', steps: ['B'] },
        ],
      },
    };
    s = upsertRoutine(s, daily, edited, noon(tomorrow));
    expect(title(s, ANCHOR)).toBe('Mobility · Upper');
    expect(title(s, tomorrow)).toBe('Mobility · Hips');
  });

  it('refuses malformed alternations and links that are not https', () => {
    const s = state();
    const withRoutine = (routine: Partial<Routine>) => () =>
      decodeState({
        ...s,
        programs: s.programs.map((p) =>
          p.id === 'daily' ? { ...p, routines: [{ ...mobility, ...routine }] } : p,
        ),
      });
    expect(withRoutine({})).not.toThrow();
    expect(
      withRoutine({ alternate: { anchor: ANCHOR, variants: [{ title: 'Only', steps: [] }] } }),
    ).toThrow();
    expect(
      withRoutine({ alternate: { anchor: 'soon', variants: mobility.alternate!.variants } }),
    ).toThrow();
    expect(withRoutine({ links: [{ label: 'Plain', url: 'http://example.com' }] })).toThrow();
    expect(withRoutine({ links: [{ label: 'Script', url: 'javascript:alert(1)' }] })).toThrow();
  });
});
