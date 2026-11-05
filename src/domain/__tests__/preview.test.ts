import { describe, expect, it } from '@jest/globals';
import { withDay } from '../data';
import { Program, State } from '../model';
import { protectDay } from '../objectives';
import { makeBlock } from '../planner';
import { tomorrowPreview } from '../preview';
import { studyState } from '../../test-support/fixtures';

// "Now" is Monday, November 9, 2026 at 18:00; tomorrow is Tuesday.
const NOW = new Date(2026, 10, 9, 18);
const TUE = '2026-11-10';

/** Upper and lower body as a rotation with Sunday rest, and a companion after lower body. */
function rotating(): State {
  const state = studyState();
  return {
    ...state,
    programs: state.programs.map((p): Program => {
      if (p.id !== 'training') return p;
      return {
        ...p,
        routines: [
          ...p.routines.map((r) => ({ ...r, weekdays: [], checklist: true })),
          {
            id: 'neck',
            title: 'Neck routine',
            duration: null,
            weekdays: [],
            preferredStart: null,
            enabled: true,
            fixed: false,
            steps: [],
            bundledInto: null,
            checklist: true,
            follows: ['lower'],
          },
        ],
        rotation: { order: ['upper', 'lower'], restDays: [0], startWith: 'upper' },
      };
    }),
  };
}
const titles = (state: State) => tomorrowPreview(state, NOW).items.map((i) => i.title);

describe("tomorrow's preview", () => {
  it('lists the due objectives without saving or changing anything', () => {
    const state = studyState();
    const before = JSON.stringify(state);
    const preview = tomorrowPreview(state, NOW);
    expect(preview.date).toBe(TUE);
    expect(preview.items.map((i) => [i.title, i.kind])).toEqual(
      expect.arrayContaining([
        ['Daily study', 'objective'],
        ['Job search', 'objective'],
      ]),
    );
    expect(JSON.stringify(state)).toBe(before);
    expect(state.days[TUE]).toBeUndefined();
    // Opening it again gives the same list: nothing accumulates.
    expect(tomorrowPreview(state, NOW)).toEqual(preview);
  });

  it('marks the next rotation workout and its companion as a projection', () => {
    const preview = tomorrowPreview(rotating(), NOW);
    expect(preview.items.slice(0, 2)).toEqual([
      // Today's upper body is assumed done, so tomorrow projects lower body.
      { id: 'projected:lower', title: 'Lower body', kind: 'workout', time: null, projected: true },
      {
        id: 'projected:neck',
        title: 'Neck routine',
        kind: 'objective',
        time: null,
        projected: true,
      },
    ]);
  });

  it('shows a rotation rest day, and nothing projected on it', () => {
    // Saturday evening: Sunday is the rotation's rest day.
    const preview = tomorrowPreview(rotating(), new Date(2026, 10, 14, 18));
    expect(preview.items.find((i) => i.kind === 'rest')).toMatchObject({
      title: 'Training · rest day',
    });
    expect(preview.items.some((i) => i.projected)).toBe(false);
  });

  it('shows timed commitments only when already on the plan, in time order', () => {
    const state = studyState();
    const late = { ...makeBlock(`${TUE}:manual:b`, 'Dentist', 17 * 60, 60), fixed: true };
    const early = { ...makeBlock(`${TUE}:manual:a`, 'Team meeting', 9 * 60 + 30, 30), fixed: true };
    const planned = withDay(state, { date: TUE, blocks: [late, early], revisions: [] });
    const timed = tomorrowPreview(planned, NOW).items.filter((i) => i.kind === 'timed');
    expect(timed.map((i) => [i.title, i.time])).toEqual([
      ['Team meeting', '9:30 AM'],
      ['Dentist', '5:00 PM'],
    ]);
    // Without a plan for tomorrow, no time is invented.
    expect(tomorrowPreview(state, NOW).items.some((i) => i.time)).toBe(false);
  });

  it('says when tomorrow is protected, and leaves out what is already done', () => {
    const state = studyState();
    const prepared = withDay(state, protectDay({ date: TUE, blocks: [], revisions: [] }, 'travel'));
    expect(tomorrowPreview(prepared, NOW).protected).toBe(true);
    expect(titles(state)).not.toContain('Weekly weigh-in');
  });
});
