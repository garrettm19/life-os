import { describe, expect, it } from '@jest/globals';
import {
  ActivitySession,
  Block,
  Day,
  Measurement,
  MoneyReview,
  Routine,
  RuleReview,
  State,
  WorkoutSession,
  dateObject,
  daysBetween,
  emptyState,
  shiftDate,
} from '../model';
import { recordedDays, recordedDaysOf } from '../focus-evidence';
import { dayClearRuns, dayClearStreak, dayOutcome, dayProgress } from '../objectives';
import {
  DEFAULT_PROGRESS_RANGE,
  PROGRESS_RANGES,
  ProgressData,
  TileId,
  cardioCard,
  changeText,
  dateText,
  dayText,
  progress,
  progressOf,
  rangeWindow,
} from '../progress';
import { toGrams } from '../records';
import { studyStreak, studyStreakLine } from '../study-streak';
import { defaultTradingProfile, tradingBook, tradingDayReader } from '../trading';
import { studyState } from '../../test-support/fixtures';
import { DAYS, TODAY as LONG_TODAY, twoYears } from '../../test-support/two-years';

// Saturday, October 17, 2026 is "today" unless a test says otherwise.
const TODAY = '2026-10-17';

/** A local time on a local date, so every time zone agrees on the day. */
const at = (date: string, hour = 12) => {
  const d = dateObject(date);
  d.setHours(hour);
  return d.toISOString();
};

function routine(id: string, extra: Partial<Routine> = {}): Routine {
  return {
    id,
    title: id.charAt(0).toUpperCase() + id.slice(1),
    duration: null,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    preferredStart: null,
    enabled: true,
    fixed: false,
    steps: [],
    bundledInto: null,
    checklist: true,
    ...extra,
  };
}

function plan(...routines: Routine[]): State {
  const state = emptyState();
  state.programs = [{ id: 'habits', title: 'Habits', group: 'Foundation', goalIds: [], routines }];
  return state;
}

function block(
  date: string,
  routineId: string,
  status: Block['status'],
  extra: Partial<Block> = {},
): Block {
  return {
    id: `${date}:routine:${routineId}`,
    routineId,
    programId: 'habits',
    title: routineId,
    start: null,
    duration: null,
    fixed: false,
    status,
    actualAt: status === 'planned' ? null : at(date, 20),
    steps: [],
    reason: null,
    checklist: true,
    ...extra,
  };
}

function day(date: string, blocks: Block[], extra: Partial<Day> = {}): Day {
  return { date, blocks, revisions: [], ...extra };
}

function withDays(state: State, ...days: Day[]): State {
  return { ...state, days: { ...state.days, ...Object.fromEntries(days.map((d) => [d.date, d])) } };
}

const protection = (date: string) => ({ reason: 'illness' as const, at: at(date, 8) });
const cleared = (date: string) => day(date, [block(date, 'walk', 'done')]);
const missed = (date: string) => day(date, [block(date, 'walk', 'planned')]);
const tile = (data: ProgressData, id: TileId) => data.tiles.find((t) => t.id === id)!;

describe('range windows', () => {
  it('covers whole Monday-to-Sunday weeks through today, 4 weeks by default', () => {
    expect(DEFAULT_PROGRESS_RANGE).toBe('4w');
    expect(PROGRESS_RANGES.map((r) => r.label)).toEqual(['4 weeks', '12 weeks', '1 year']);
    const w = rangeWindow('12w', TODAY);
    expect(w.from).toBe('2026-07-27');
    expect(w.to).toBe(TODAY);
    expect(w.weekStarts).toHaveLength(12);
    expect(w.weekStarts.at(-1)).toBe('2026-10-12');
    expect(w.text).toBe('Jul 27 to Oct 17');
    // The previous range is as long and ends on the same weekday, so a week in progress is
    // compared with the same part of a week.
    expect(w.previous).toEqual({ from: '2026-05-04', to: '2026-07-25' });
    expect(daysBetween(w.previous.from, w.previous.to)).toBe(daysBetween(w.from, w.to));
  });

  it('a year is 52 weeks, and a range crossing a year names both years', () => {
    const year = rangeWindow('1y', TODAY);
    expect(year.weekStarts).toHaveLength(52);
    expect(year.from).toBe('2025-10-20');
    expect(year.text).toBe('Oct 20, 2025 to Oct 17, 2026');
    const w = rangeWindow('4w', '2027-01-06');
    expect(w.weekStarts).toEqual(['2026-12-14', '2026-12-21', '2026-12-28', '2027-01-04']);
    expect(w.text).toBe('Dec 14, 2026 to Jan 6, 2027');
    expect(w.previous).toEqual({ from: '2026-11-16', to: '2026-12-09' });
  });

  it('keeps every week a Monday seven days apart across daylight-saving changes', () => {
    for (const today of ['2026-11-04', '2026-03-18', '2026-03-29'])
      for (const range of ['4w', '12w', '1y'] as const) {
        const { weekStarts } = rangeWindow(range, today);
        weekStarts.forEach((w, i) => {
          expect(dateObject(w).getDay()).toBe(1);
          if (i) expect(daysBetween(weekStarts[i - 1], w)).toBe(7);
        });
      }
  });

  it('names the year of a date in another year than today, and only then', () => {
    expect(dateText('2026-10-12', TODAY)).toBe('Oct 12');
    expect(dateText('2025-10-20', TODAY)).toBe('Oct 20, 2025');
    expect(dateText('2026-12-28', '2027-01-06')).toBe('Dec 28, 2026');
    expect(dayText('2026-10-12', TODAY)).toBe('Mon, Oct 12');
    expect(dayText('2025-10-20', TODAY)).toBe('Mon, Oct 20, 2025');
  });

  it('refuses an invalid date and says a change in words', () => {
    expect(() => rangeWindow('4w', '2026-02-30')).toThrow('Use a valid calendar date.');
    expect(changeText(3, 'previous 12 weeks')).toBe('+3 vs previous 12 weeks');
    expect(changeText(-2, 'previous year')).toBe('−2 vs previous year');
    expect(changeText(0, 'previous 4 weeks')).toBe('Same as previous 4 weeks');
  });
});

describe('an empty or new plan', () => {
  it('shows the streak and cleared tiles with what will fill them, and no cards', () => {
    const data = progress(emptyState(), '12w', TODAY);
    expect(data.tiles.map((t) => [t.id, t.value, t.empty])).toEqual([
      ['streak', null, 'Clear a day on Today to start the streak.'],
      ['cleared', null, 'A day counts here once it is cleared or over.'],
    ]);
    for (const card of [
      data.consistency,
      data.weight,
      data.strength,
      data.study,
      data.cardio,
      data.jobs,
      data.money,
      data.trading,
      data.habits,
    ])
      expect(card).toBeNull();
  });

  it('keeps the empty streak hint until a day has been cleared, even with days on record', () => {
    const empty = 'Clear a day on Today to start the streak.';
    // Today opened and still open, then a missed day before it: no day was ever cleared.
    for (const state of [
      withDays(plan(routine('walk')), missed(TODAY)),
      withDays(plan(routine('walk')), missed('2026-10-16'), missed(TODAY)),
    ])
      expect(tile(progress(state, '12w', TODAY), 'streak')).toMatchObject({
        value: null,
        change: null,
        empty,
      });
    // Once a day is cleared, the tile counts.
    const once = withDays(plan(routine('walk')), cleared('2026-10-16'), missed(TODAY));
    expect(tile(progress(once, '12w', TODAY), 'streak').value).not.toBeNull();
  });

  it('a plan without records has the consistency and habit cards, each saying what fills it', () => {
    const data = progress(plan(routine('walk')), '12w', TODAY);
    expect(data.consistency).toMatchObject({
      state: 'empty',
      headline: 'Nothing due was recorded in the last 12 weeks',
      note: 'Finish objectives on Today to start the line.',
    });
    expect(data.consistency!.weeks.every((w) => w.value === null)).toBe(true);
    expect(data.habits).toMatchObject({ state: 'empty', rows: [] });
    expect(data.weight).toBeNull();
    expect(data.money).toBeNull();
  });

  it('a routine paused in Programs adds no card until it is resumed; its records still do', () => {
    const routines = [
      routine('weigh', { capture: 'weight' }),
      routine('run', { capture: 'activity' }),
      routine('budget', { capture: 'money' }),
    ];
    const paused = plan(routine('walk'), ...routines.map((r) => ({ ...r, enabled: false })));
    const data = progress(paused, '4w', TODAY);
    expect([data.weight, data.cardio, data.money]).toEqual([null, null, null]);
    expect(data.habits).toMatchObject({ state: 'empty', rows: [] });
    // Resumed, each card is back, saying what fills it.
    const back = progress(plan(routine('walk'), ...routines), '4w', TODAY);
    expect([back.weight, back.cardio, back.money].map((c) => c?.state)).toEqual([
      'empty',
      'empty',
      'empty',
    ]);
    // A weigh-in recorded before the pause is a record of its own: its card stays.
    const weighIn: Measurement = {
      id: 'm-1',
      kind: 'body-weight',
      grams: toGrams(180, 'lb'),
      entered: { value: 180, unit: 'lb' },
      date: '2026-10-12',
      at: at('2026-10-12', 7),
      fasted: null,
      note: '',
      occurrenceId: null,
    };
    expect(progress({ ...paused, measurements: [weighIn] }, '4w', TODAY).weight).not.toBeNull();
    // With every routine paused and nothing recorded, there are no habits to show.
    const all = plan(...routines.map((r) => ({ ...r, enabled: false })));
    expect(progress(all, '4w', TODAY).habits).toBeNull();
  });
});

describe('Day Clear tiles', () => {
  // Previous range (Aug 24 to Sep 19): a miss, then three cleared days. This range (from Sep 21):
  // a miss, two cleared days, a day never opened, a protected day left open, two cleared days.
  const state = withDays(
    plan(routine('walk')),
    missed('2026-09-16'),
    cleared('2026-09-17'),
    cleared('2026-09-18'),
    cleared('2026-09-19'),
    missed('2026-09-22'),
    cleared('2026-10-12'),
    cleared('2026-10-13'),
    day('2026-10-15', [block('2026-10-15', 'walk', 'planned')], {
      protection: protection('2026-10-15'),
    }),
    cleared('2026-10-16'),
    cleared(TODAY),
  );

  it('reads the streak with the one rule: Not recorded and Protected never break it', () => {
    const data = progress(state, '4w', TODAY);
    expect(dayClearStreak(state, TODAY, TODAY)).toEqual({ current: 4, best: 4 });
    expect(tile(data, 'streak')).toMatchObject({
      value: '4 days',
      detail: 'Best 4',
      // Three days 4 weeks ago (Sep 19), four now.
      delta: 1,
      change: '+1 vs 4 weeks ago',
      empty: null,
    });
    // The run at the end of each week; a week with nothing recorded carries it.
    expect(tile(data, 'streak').spark).toEqual([
      { date: '2026-09-21', y: 0 },
      { date: '2026-09-28', y: 0 },
      { date: '2026-10-05', y: 0 },
      { date: '2026-10-12', y: 4 },
    ]);
  });

  it('counts cleared days of the days that counted, against the previous range', () => {
    const data = progress(state, '4w', TODAY);
    expect(tile(data, 'cleared')).toMatchObject({
      value: '4 of 5',
      detail: '80% cleared',
      delta: 1,
      change: '+1 vs previous 4 weeks',
    });
    expect(tile(data, 'cleared').spark).toEqual([
      { date: '2026-09-21', y: 0 },
      { date: '2026-10-12', y: 4 },
    ]);
  });

  it('today counts once cleared, or once it can no longer be cleared', () => {
    const open = withDays(state, missed(TODAY));
    expect(tile(progress(open, '4w', TODAY), 'cleared').value).toBe('3 of 4');
    const skipped = withDays(state, day(TODAY, [block(TODAY, 'walk', 'skipped')]));
    expect(tile(progress(skipped, '4w', TODAY), 'cleared').value).toBe('3 of 5');
  });

  it('says when there is nothing to compare with', () => {
    const recent = withDays(plan(routine('walk')), cleared('2026-10-16'), cleared(TODAY));
    const data = progress(recent, '12w', TODAY);
    expect(tile(data, 'streak')).toMatchObject({
      value: '2 days',
      delta: null,
      change: 'Nothing recorded 12 weeks ago',
    });
    expect(tile(data, 'cleared')).toMatchObject({
      value: '2 of 2',
      delta: null,
      change: 'Nothing recorded in the previous 12 weeks',
    });
  });

  it('an optional objective left open never stops a day from clearing', () => {
    const s = withDays(
      plan(routine('walk'), routine('stretch', { optional: true })),
      day(TODAY, [
        block(TODAY, 'walk', 'done'),
        block(TODAY, 'stretch', 'planned', { optional: true }),
      ]),
    );
    expect(tile(progress(s, '4w', TODAY), 'cleared').value).toBe('1 of 1');
  });

  it('reads the same across a new year', () => {
    const today = '2027-01-06';
    const s = withDays(
      plan(routine('walk')),
      missed('2026-12-29'),
      cleared('2026-12-30'),
      cleared('2026-12-31'),
      cleared('2027-01-01'),
      cleared('2027-01-04'),
      cleared(today),
    );
    const data = progress(s, '4w', today);
    expect(tile(data, 'streak').value).toBe('5 days');
    expect(tile(data, 'cleared').value).toBe('5 of 6');
    expect(data.consistency!.weeks.map((w) => w.value)).toEqual([null, null, 75, 100]);
  });
});

describe('consistency', () => {
  const s = withDays(
    plan(
      routine('walk'),
      routine('read'),
      routine('stretch', { optional: true }),
      routine('gym', { duration: 60, checklist: false }),
    ),
    // Previous range: 1 of 2.
    day('2026-09-14', [block('2026-09-14', 'walk', 'done')]),
    day('2026-09-15', [block('2026-09-15', 'walk', 'planned')]),
    // Week of Sep 21: 1 of 1; the optional stretch is never counted, and the skipped walk is
    // excused, so it is not due.
    day('2026-09-21', [
      block('2026-09-21', 'walk', 'done'),
      block('2026-09-21', 'stretch', 'planned', { optional: true }),
    ]),
    day('2026-09-22', [block('2026-09-22', 'walk', 'skipped')]),
    // Week of Oct 5: protected days count only what was done there.
    day('2026-10-05', [block('2026-10-05', 'walk', 'planned')], {
      protection: protection('2026-10-05'),
    }),
    day('2026-10-06', [block('2026-10-06', 'walk', 'done')], {
      protection: protection('2026-10-06'),
    }),
    // Week of Oct 12: an open day, a timed session due and never placed, a full day, and today
    // counting only what is already done (a skip there is excused too).
    day('2026-10-12', [block('2026-10-12', 'walk', 'planned')]),
    day('2026-10-14', [], { dueTimed: ['gym'] }),
    day('2026-10-13', [block('2026-10-13', 'walk', 'done'), block('2026-10-13', 'read', 'done')]),
    day(TODAY, [
      block(TODAY, 'walk', 'done'),
      block(TODAY, 'read', 'planned'),
      block(TODAY, 'gym', 'skipped'),
    ]),
  );

  it('is the share of required objectives done each week, from each day’s progress', () => {
    const card = progress(s, '4w', TODAY).consistency!;
    expect(card.weeks.map((w) => [w.weekStart, w.value, w.done, w.total, w.inProgress])).toEqual([
      ['2026-09-21', 100, 1, 1, false],
      ['2026-09-28', null, 0, 0, false],
      ['2026-10-05', 100, 1, 1, false],
      ['2026-10-12', 60, 3, 5, true],
    ]);
    expect(card.share).toBe(71);
    expect(card.previousShare).toBe(50);
    expect(card.headline).toBe('71% of required objectives done in the last 4 weeks, up from 50%');
    expect(card.state).toBe('chart');
    expect(card.summary).toBe(`${card.headline}. Last 4 weeks, Sep 21 to Oct 17.`);
    // The totals are dayProgress's own: nothing is counted a second way.
    expect(dayProgress(s.days['2026-10-14'], s.programs, '2026-10-14').total).toBe(1);
    expect(dayProgress(s.days['2026-09-22'], s.programs, '2026-09-22')).toMatchObject({
      done: 0,
      total: 0,
      skipped: 1,
    });
  });

  it('one week with records shows the figure and what starts the line', () => {
    const one = withDays(plan(routine('walk')), cleared('2026-10-13'));
    expect(progress(one, '12w', TODAY).consistency).toMatchObject({
      state: 'sparse',
      headline: '100% of required objectives done in the last 12 weeks',
      note: 'The next week starts the line.',
    });
  });

  it('says down or the same against the previous range', () => {
    const down = withDays(plan(routine('walk')), cleared('2026-09-14'), missed('2026-10-13'));
    expect(progress(down, '4w', TODAY).consistency!.headline).toBe(
      '0% of required objectives done in the last 4 weeks, down from 100%',
    );
    const same = withDays(plan(routine('walk')), cleared('2026-09-14'), cleared('2026-10-13'));
    expect(progress(same, '4w', TODAY).consistency!.headline).toBe(
      '100% of required objectives done in the last 4 weeks, the same as the previous 4 weeks',
    );
  });
});

describe('weigh-ins', () => {
  const weight = (date: string, value: number, unit: 'lb' | 'kg' = 'lb'): Measurement => ({
    id: `w-${date}`,
    kind: 'body-weight',
    grams: toGrams(value, unit),
    entered: { value, unit },
    date,
    at: at(date, 7),
    fasted: null,
    note: '',
    occurrenceId: null,
  });
  const base = plan(routine('weigh', { capture: 'weight', optional: true }));

  it('draws the weigh-ins in the range and says the measured change since the first', () => {
    const s = {
      ...base,
      measurements: [
        weight('2026-07-20', 182),
        weight('2026-09-28', 180.4),
        weight('2026-10-05', 179),
        weight('2026-10-12', 178.3),
      ],
    };
    const card = progress(s, '12w', TODAY).weight!;
    expect(card.points).toEqual([
      { date: '2026-09-28', y: 180.4 },
      { date: '2026-10-05', y: 179 },
      { date: '2026-10-12', y: 178.3 },
    ]);
    expect(card).toMatchObject({
      unit: 'lb',
      change: -2.1,
      state: 'chart',
      headline: 'Down 2.1 lb since Sep 28',
    });
    // In 4 weeks the line starts at Sep 28 too; the July weigh-in is outside both ranges.
    const later = { ...s, measurements: [...s.measurements, weight('2026-10-16', 178.8)] };
    expect(progress(later, '4w', TODAY).weight!.headline).toBe('Down 1.6 lb since Sep 28');
    const gained = { ...base, measurements: [weight('2026-10-05', 179), weight(TODAY, 179.5)] };
    expect(progress(gained, '4w', TODAY).weight!.headline).toBe('Up 0.5 lb since Oct 5');
    const flat = { ...base, measurements: [weight('2026-10-05', 179), weight(TODAY, 179)] };
    expect(progress(flat, '4w', TODAY).weight!.headline).toBe('No change since Oct 5');
  });

  it('names the year of a weigh-in from another year, so a year range never reads as days ahead', () => {
    const s = { ...base, measurements: [weight('2025-10-20', 200), weight('2026-10-12', 181.8)] };
    expect(progress(s, '1y', TODAY).weight!.headline).toBe('Down 18.2 lb since Oct 20, 2025');
    const old = { ...base, measurements: [weight('2025-10-20', 200)] };
    expect(progress(old, '1y', TODAY).weight!.headline).toBe('200 lb on Oct 20, 2025');
    // Within this year, no year.
    expect(progress(s, '12w', TODAY).weight!.headline).toBe('181.8 lb on Oct 12');
  });

  it('gives the seven-day average beside each weigh-in whose week has four or more', () => {
    const week = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];
    const s = { ...base, measurements: week.map((d, i) => weight(d, 180 - i * 0.4)) };
    const card = progress(s, '4w', TODAY).weight!;
    expect(card.points).toHaveLength(4);
    // Only the fourth weigh-in has four in its seven days.
    expect(card.average).toEqual([{ date: '2026-10-15', y: 179.4 }]);
  });

  it('one weigh-in is a figure, none in the range says what fills it', () => {
    const one = { ...base, measurements: [weight('2026-07-20', 182), weight('2026-10-12', 178.3)] };
    expect(progress(one, '4w', TODAY).weight).toMatchObject({
      state: 'sparse',
      headline: '178.3 lb on Oct 12',
      note: 'The next weigh-in starts the line.',
    });
    const old = { ...base, measurements: [weight('2026-07-20', 182)] };
    expect(progress(old, '4w', TODAY).weight).toMatchObject({
      state: 'empty',
      headline: 'No weigh-ins in the last 4 weeks',
      note: 'Record a weigh-in to start the line.',
    });
    expect(progress(one, '4w', TODAY).weight!.average).toEqual([]);
    // The card exists for a weigh-in routine or a weigh-in, never otherwise.
    expect(progress(base, '4w', TODAY).weight?.state).toBe('empty');
    expect(progress(plan(routine('walk')), '4w', TODAY).weight).toBeNull();
  });
});

describe('strength', () => {
  type Spec = { id: string; name: string; unit?: 'lb' | 'kg'; sets: [number | null, number][] };
  const session = (date: string, exercises: Spec[]): WorkoutSession => ({
    id: `session:${date}`,
    templateId: 't',
    routineId: 'upper',
    occurrenceId: `${date}:routine:upper`,
    scheduledDate: date,
    date,
    startedAt: at(date, 10),
    finishedAt: at(date, 11),
    status: 'completed',
    note: '',
    exercises: exercises.map((e) => ({
      exerciseId: e.id,
      name: e.name,
      unit: e.unit ?? 'lb',
      plan: { sets: e.sets.length, repsMin: 5, repsMax: null, load: null },
      sets: e.sets.map(([load, reps]) => ({ load, reps, done: true })),
    })),
  });
  const bench = (sets: [number | null, number][]) => ({ id: 'bench', name: 'Bench press', sets });
  const pullUp = (reps: number) => ({
    id: 'pull',
    name: 'Pull-up',
    sets: [[null, reps]] as [null, number][],
  });
  const s: State = {
    ...emptyState(),
    workoutSessions: [
      session('2026-06-01', [{ id: 'row', name: 'Barbell row', sets: [[95, 8]] }]),
      session('2026-09-28', [
        bench([
          [135, 8],
          [155, 5],
        ]),
        pullUp(8),
        { id: 'press', name: 'Leg press', unit: 'kg', sets: [[82.5, 10]] },
        { id: 'squat', name: 'Back squat', sets: [[225, 5]] },
      ]),
      session('2026-10-01', [{ id: 'ohp', name: 'Overhead press', sets: [[95, 5]] }]),
      session('2026-10-12', [
        bench([[170, 5]]),
        { id: 'press', name: 'Leg press', unit: 'kg', sets: [[85, 10]] },
        { id: 'squat', name: 'Back squat', sets: [[225, 6]] },
      ]),
      {
        ...session('2026-10-14', [pullUp(9)]),
        id: 'session:sled',
        exercises: [
          ...session('2026-10-14', [pullUp(9)]).exercises,
          {
            exerciseId: 'sled',
            name: 'Sled push',
            unit: 'lb',
            kind: 'time',
            plan: { sets: 1, repsMin: 1, repsMax: null, load: null, seconds: 30 },
            sets: [{ load: null, reps: null, seconds: 30, done: true }],
          },
        ],
      },
    ],
  };

  it('has one line per lift with history in the range, most recently trained first', () => {
    const card = progress(s, '12w', TODAY).strength!;
    // The row was trained only before the range; a timed exercise has no heaviest set. Lifts
    // last trained on the same day are in name order.
    expect(card.lifts.map((l) => l.key)).toEqual([
      'pull|lb',
      'squat|lb',
      'bench|lb',
      'press|kg',
      'ohp|lb',
    ]);
    const benchLift = card.lifts.find((l) => l.key === 'bench|lb')!;
    expect(benchLift.points).toEqual([
      { date: '2026-09-28', y: 155 },
      { date: '2026-10-12', y: 170 },
    ]);
    expect(benchLift).toMatchObject({
      measure: 'load',
      change: 15,
      state: 'chart',
      headline: 'Bench press up 15 lb in the last 12 weeks',
    });
    expect(benchLift.sessions.map((x) => x.reps)).toEqual([5, 5]);
    expect(card.headline).toBe('Pull-up up 1 rep in the last 12 weeks');
  });

  it('words each lift plainly: reps without a load, decimals, held, a single session', () => {
    const lifts = new Map(progress(s, '12w', TODAY).strength!.lifts.map((l) => [l.key, l]));
    expect(lifts.get('pull|lb')).toMatchObject({ measure: 'reps', change: 1 });
    expect(lifts.get('press|kg')!.headline).toBe('Leg press up 2.5 kg in the last 12 weeks');
    expect(lifts.get('squat|lb')!.headline).toBe('Back squat held at 225 lb in the last 12 weeks');
    expect(lifts.get('ohp|lb')).toMatchObject({
      state: 'sparse',
      change: null,
      headline: 'Overhead press 95 lb on Oct 1',
      note: 'The next session starts the line.',
    });
  });

  it('without a session in the range the card says what fills it', () => {
    const card = progress(s, '4w', '2026-12-31').strength!;
    expect(card).toMatchObject({
      lifts: [],
      state: 'empty',
      headline: 'No finished workouts with logged sets in the last 4 weeks',
      note: 'Finish a workout with logged sets to start the line.',
    });
    expect(progress(emptyState(), '4w', TODAY).strength).toBeNull();
  });
});

describe('study', () => {
  const S_TODAY = '2026-11-11';
  const studyDay = (date: string, status: Block['status'], extra: Partial<Day> = {}) =>
    day(date, [block(date, 'study', status)], extra);
  function recorded(): State {
    let s = studyState();
    // Kept Oct 19 to 28, a protected day skipped on Oct 29, then nothing opened (missed days).
    for (let i = 0; i < 10; i++) s = withDays(s, studyDay(shiftDate('2026-10-19', i), 'done'));
    s = withDays(s, studyDay('2026-10-29', 'skipped', { protection: protection('2026-10-29') }));
    const timed: ActivitySession = {
      id: 'a-study',
      date: '2026-10-20',
      at: at('2026-10-20', 19),
      routineId: 'study',
      occurrenceId: '2026-10-20:routine:study',
      activity: 'Study',
      minutes: 60,
      note: '',
      study: { startedAt: at('2026-10-20', 18), stages: [] },
    };
    const cardio: ActivitySession = { ...timed, id: 'a-run', routineId: null, study: undefined };
    return { ...s, activitySessions: [timed, cardio] };
  }

  it('counts study days by the study streak’s rules, with the streak beside them', () => {
    const s = recorded();
    const data = progress(s, '4w', S_TODAY);
    const routine = s.programs.flatMap((p) => p.routines).find((r) => r.id === 'study')!;
    expect(tile(data, 'study')).toMatchObject({
      label: 'Study days',
      // With its denominator, so it never reads against the streak line under it.
      value: '10 of 22',
      detail: studyStreakLine(studyStreak(s, routine, S_TODAY)),
      // Every scheduled day of the previous range was never opened: all missed.
      delta: 10,
      change: '+10 vs previous 4 weeks',
    });
    const card = data.study!;
    expect(card.weeks.map((w) => [w.value, w.kept, w.eligible, w.minutes])).toEqual([
      [7, 7, 7, 60],
      [3, 3, 6, 0],
      [0, 0, 7, 0],
      // Today is still open, so the week so far has two scored days.
      [0, 0, 2, 0],
    ]);
    // The tile has the range's days and the streak; the card says where the weeks are going.
    expect(card.headline).toBe('Last week 0 of 7 study days kept, down from 3 of 6');
  });

  it('words the latest finished week against the one before it, or says none has finished', () => {
    const s = recorded();
    // Oct 19 to 28 kept: the week of Oct 26 (3 of 6) against the week of Oct 19 (7 of 7).
    expect(progress(s, '4w', '2026-11-02').study!.headline).toBe(
      'Last week 3 of 6 study days kept, down from 7 of 7',
    );
    let up = s;
    for (let i = 0; i < 7; i++)
      up = withDays(up, studyDay(shiftDate('2026-11-02', i), i < 5 ? 'done' : 'skipped'));
    expect(progress(up, '4w', '2026-11-09').study!.headline).toBe(
      'Last week 5 of 7 study days kept, up from 3 of 6',
    );
    // Before any week has finished, this week's days are the tile's figure: the card never repeats
    // it, and says what starts the chart.
    const fresh = studyState();
    fresh.programs = fresh.programs.map((p) => ({
      ...p,
      routines: p.routines.map((r) =>
        r.study ? { ...r, study: { ...r.study, trackFrom: '2026-11-09' } } : r,
      ),
    }));
    const started = withDays(fresh, studyDay('2026-11-09', 'done'), studyDay('2026-11-10', 'done'));
    const data = progress(started, '12w', S_TODAY);
    expect(tile(data, 'study').value).toBe('2 of 2');
    expect(data.study).toMatchObject({
      headline: 'No finished study week in the last 12 weeks',
      state: 'sparse',
      note: 'The next week of study starts the chart.',
    });
    // The next Monday: the one finished week holds every scored day, so its days are the tile's
    // figure too, and the card says only that it was the first.
    const monday = progress(started, '12w', '2026-11-16');
    const { kept, eligible } = monday.study!.weeks.at(-2)!;
    expect(tile(monday, 'study').value).toBe(`${kept} of ${eligible}`);
    expect(monday.study!.headline).toBe('Last week was the first study week in the last 12 weeks');
    // Once this week has a scored day, last week's figure is no longer the tile's.
    const today = progress(withDays(started, studyDay('2026-11-16', 'done')), '12w', '2026-11-16');
    expect(tile(today, 'study').value).toBe(`${kept + 1} of ${eligible + 1}`);
    expect(today.study!.headline).toBe(`Last week ${kept} of ${eligible} study days kept`);
  });

  it('an optional study objective is read by its recorded days, never as missed', () => {
    // As in Programs: the study objective made optional, its blocks planned as optional.
    let s = studyState();
    s.programs = s.programs.map((p) => ({
      ...p,
      routines: p.routines.map((r) => (r.study ? { ...r, optional: true } : r)),
    }));
    for (let i = 0; i < 10; i++) {
      const d = shiftDate('2026-11-01', i);
      s = withDays(s, day(d, [block(d, 'study', 'done', { optional: true })]));
    }
    const data = progress(s, '4w', S_TODAY);
    expect(data.habits!.rows.find((r) => r.routineId === 'study')).toMatchObject({
      done: 10,
      due: 10,
      share: 100,
      optional: true,
    });
    // Optional study is not a required study objective: no Study tile or card counts it.
    expect(data.tiles.map((t) => t.id)).not.toContain('study');
    expect(data.study).toBeNull();
  });

  it('nothing is scored before the study streak starts', () => {
    const s = studyState();
    s.programs = s.programs.map((p) => ({
      ...p,
      routines: p.routines.map((r) =>
        r.study ? { ...r, study: { ...r.study, trackFrom: undefined, schedule: [] } } : r,
      ),
    }));
    const data = progress(s, '4w', S_TODAY);
    expect(tile(data, 'study')).toMatchObject({
      value: null,
      empty: 'Study days count once the study streak starts.',
    });
    expect(data.study).toMatchObject({
      state: 'empty',
      headline: 'No scored study days in the last 4 weeks',
      note: 'Study days count once the study streak starts.',
    });
  });

  it('career actions per week, against the previous range', () => {
    let s = recorded();
    const job = (date: string, status: Block['status']) =>
      withDays(s, day(date, [...(s.days[date]?.blocks ?? []), block(date, 'job-search', status)]));
    for (const d of ['2026-09-21', '2026-09-22']) s = job(d, 'done');
    for (let i = 0; i < 5; i++) s = job(shiftDate('2026-10-19', i), 'done');
    s = job('2026-10-26', 'skipped');
    s = job('2026-10-27', 'planned');
    s = job(S_TODAY, 'planned');
    const data = progress(s, '4w', S_TODAY);
    expect(data.jobs!.weeks.map((w) => [w.value, w.done, w.due])).toEqual([
      [5, 5, 5],
      [0, 0, 2],
      [null, 0, 0],
      // Today's job search is not counted until it is done or skipped.
      [null, 0, 0],
    ]);
    expect(data.jobs).toMatchObject({
      done: 5,
      previousDone: 2,
      headline: '5 career actions in the last 4 weeks, up from 2',
    });
    // Each routine's completion: study by its streak rules, the job search by recorded days, where
    // the skip on the 26th is excused, so it is not due.
    expect(data.habits!.rows.map((r) => [r.routineId, r.done, r.due])).toEqual([
      ['job-search', 5, 6],
      ['study', 10, 22],
    ]);
    expect(data.habits!.headline).toBe('Job search: done on 5 of 6 days');
  });

  it('counts job-search objectives, so two routines due on one day count twice', () => {
    let s = recorded();
    s.programs = s.programs.map((p) =>
      p.routines.some((r) => r.id === 'job-search')
        ? {
            ...p,
            routines: [
              ...p.routines,
              {
                ...p.routines.find((r) => r.id === 'job-search')!,
                id: 'network',
                title: 'Network',
              },
            ],
          }
        : p,
    );
    const both = (date: string, network: Block['status']) =>
      day(date, [block(date, 'job-search', 'done'), block(date, 'network', network)]);
    s = withDays(s, both('2026-11-02', 'done'), both('2026-11-03', 'planned'));
    const week = progress(s, '4w', S_TODAY).jobs!.weeks[2];
    // Two days, four objectives due, three done: the readout says "Done 3 of 4 times due".
    expect([week.done, week.due]).toEqual([3, 4]);
  });

  it('a job search with no recorded day says what fills it', () => {
    expect(progress(recorded(), '4w', S_TODAY).jobs).toMatchObject({
      state: 'empty',
      headline: 'No career days recorded in the last 4 weeks',
      note: 'Do a career objective on Today to start the chart.',
    });
  });
});

describe('cardio', () => {
  const run = (date: string, minutes: number): ActivitySession => ({
    id: `run-${date}-${minutes}`,
    date,
    at: at(date, 7),
    routineId: 'cardio',
    occurrenceId: null,
    activity: 'Run',
    minutes,
    note: '',
  });
  // 30 minutes on Monday, Wednesday and Friday: a 90-minute weekly target.
  const base = plan(routine('cardio', { capture: 'activity', duration: 30, weekdays: [1, 3, 5] }));
  const sessions = [
    run('2026-09-22', 60),
    run('2026-09-24', 40),
    run('2026-10-05', 45),
    run('2026-10-07', 45),
    run('2026-10-13', 30),
  ];

  it('totals recorded minutes per week, judges each finished week against its target', () => {
    const studied: ActivitySession = {
      ...run('2026-10-14', 60),
      routineId: 'study',
      study: { startedAt: at('2026-10-14', 6), stages: [] },
    };
    const card = progress(
      { ...base, activitySessions: [...sessions, studied] },
      '4w',
      TODAY,
    ).cardio!;
    expect(card.weeks.map((w) => [w.value, w.sessions, w.target, w.hit])).toEqual([
      [100, 2, 90, true],
      [null, 0, 90, false],
      [90, 2, 90, true],
      // A study session is never cardio; this week is still in progress.
      [30, 1, 90, false],
    ]);
    expect(card.target).toBe(90);
    expect(card.headline).toBe('2 of the last 3 weeks hit 90 cardio minutes');
  });

  it('counts the week in progress once it reached the target, and only weeks in use', () => {
    const reached = { ...base, activitySessions: [...sessions, run('2026-10-16', 60)] };
    expect(progress(reached, '4w', TODAY).cardio!.headline).toBe(
      '3 of the last 4 weeks hit 90 cardio minutes',
    );
    const started = { ...base, activitySessions: sessions.slice(2) };
    expect(progress(started, '4w', TODAY).cardio!.headline).toBe('Last week hit 90 cardio minutes');
    const each = { ...base, activitySessions: [...sessions.slice(2), run('2026-09-30', 95)] };
    expect(progress(each, '4w', TODAY).cardio!.headline).toBe(
      'Each of the last 2 weeks hit 90 cardio minutes',
    );
  });

  it('narrows to one activity routine, with that routine’s own sessions and target', () => {
    const swim = routine('swim', { capture: 'activity', duration: 20, weekdays: [6] });
    const both: State = {
      ...base,
      programs: [{ ...base.programs[0], routines: [...base.programs[0].routines, swim] }],
      activitySessions: [
        ...sessions,
        { ...run('2026-10-10', 25), id: 'swim-1', routineId: 'swim', activity: 'Swim' },
      ],
    };
    const window = rangeWindow('4w', TODAY);
    const all = cardioCard(both, window);
    // Two routines with different targets: no single target line for every activity.
    expect(all.target).toBeNull();
    expect(all.weeks.map((w) => w.value)).toEqual([100, null, 115, 30]);
    const one = cardioCard(both, window, 'swim');
    expect(one.target).toBe(20);
    expect(one.weeks.map((w) => [w.value, w.hit])).toEqual([
      [null, false],
      [null, false],
      [25, true],
      [null, false],
    ]);
    // Swimming was first recorded on Saturday, October 10: the weeks before it are not misses.
    expect(one.headline).toBe('Last week hit 20 cardio minutes');
    expect(cardioCard(both, window, 'cardio').weeks.map((w) => w.value)).toEqual([
      100,
      null,
      90,
      30,
    ]);
  });

  it('judges no week before the activity was on the plan, nor its first part week as a miss', () => {
    // In use from August 3 with a daily habit; the walk (90 min a week) added on Monday, October 5
    // and done on each of its days since.
    const C_TODAY = '2026-10-18';
    let later = plan(
      routine('tidy'),
      routine('cardio', { capture: 'activity', duration: 30, weekdays: [1, 3, 5] }),
    );
    for (let d = '2026-08-03'; d < C_TODAY; d = shiftDate(d, 1)) {
      const walk = dateObject(d).getDay() % 2 === 1 && d >= '2026-10-05';
      later = withDays(
        later,
        day(d, [block(d, 'tidy', 'done'), ...(walk ? [block(d, 'cardio', 'done')] : [])]),
      );
    }
    const walks = Object.values(later.days)
      .filter((d) => d.blocks.some((b) => b.routineId === 'cardio'))
      .map((d) => run(d.date, 30));
    expect(walks).toHaveLength(6);
    const data = progress({ ...later, activitySessions: walks }, '12w', C_TODAY);
    expect(data.habits!.rows.find((r) => r.routineId === 'cardio')).toMatchObject({
      done: 6,
      due: 6,
    });
    // This week reached its target already, so it is judged with last week; nothing before.
    expect(data.cardio!.headline).toBe('Each of the last 2 weeks hit 90 cardio minutes');
    // Started on Saturday, October 10 with a daily 30-minute walk, done every day: the first week
    // had two days in use, so it is not judged against seven days' target.
    const daily = plan(routine('cardio', { capture: 'activity', duration: 30 }));
    const days = Array.from({ length: 8 }, (_, i) => shiftDate('2026-10-10', i));
    const fresh = {
      ...withDays(daily, ...days.map((d) => day(d, [block(d, 'cardio', 'done')]))),
      activitySessions: days.map((d) => run(d, 30)),
    };
    expect(progress(fresh, '12w', C_TODAY).cardio!.headline).toBe(
      '240 cardio minutes recorded in the last 12 weeks',
    );
  });

  it('without a target it says the minutes; without records what fills it', () => {
    const free = plan(routine('cardio', { capture: 'activity' }));
    expect(progress({ ...free, activitySessions: sessions }, '4w', TODAY).cardio).toMatchObject({
      target: null,
      headline: '220 cardio minutes recorded in the last 4 weeks',
    });
    expect(progress(base, '4w', TODAY).cardio).toMatchObject({
      state: 'empty',
      headline: 'No cardio recorded in the last 4 weeks',
      note: 'Record a cardio session to start the chart.',
    });
    const one = { ...base, activitySessions: [run('2026-10-13', 30)] };
    expect(progress(one, '4w', TODAY).cardio).toMatchObject({
      state: 'sparse',
      note: 'The next week with cardio starts the chart.',
    });
    expect(progress(plan(routine('walk')), '4w', TODAY).cardio).toBeNull();
  });
});

describe('money', () => {
  const review = (
    date: string,
    debt: number | null,
    savings: number | null,
    currency = 'USD',
  ): MoneyReview => ({
    id: `m-${date}`,
    date,
    at: at(date, 18),
    currency,
    cash: null,
    savings,
    debt,
    upcoming: null,
    contributed: null,
    savingsTarget: null,
    nextAction: '',
    note: '',
    goalId: null,
    occurrenceId: null,
  });
  const base = plan(routine('money', { capture: 'money', weekdays: [0] }));

  it('draws debt and savings on one scale and says each change, debt first', () => {
    const s = {
      ...base,
      moneyReviews: [
        review('2026-09-28', 500_000, 100_000),
        review('2026-10-12', 480_000, 105_000),
      ],
    };
    const card = progress(s, '12w', TODAY).money!;
    expect(card).toMatchObject({
      currency: 'USD',
      debtChange: -20_000,
      savingsChange: 5_000,
      state: 'chart',
      headline: 'Debt down $200.00 and savings up $50.00 since Sep 28',
    });
    expect(card.debt).toEqual([
      { date: '2026-09-28', y: 500_000 },
      { date: '2026-10-12', y: 480_000 },
    ]);
    const apart = {
      ...base,
      moneyReviews: [
        review('2026-09-28', 500_000, null),
        review('2026-10-05', 510_000, 100_000),
        review('2026-10-12', 510_000, 100_000),
      ],
    };
    expect(progress(apart, '12w', TODAY).money!.headline).toBe(
      'Debt up $100.00 since Sep 28 · savings unchanged since Oct 5',
    );
  });

  it('names the year of a check-in from another year', () => {
    const s = {
      ...base,
      moneyReviews: [
        review('2025-10-26', 600_000, 100_000),
        review('2026-10-12', 500_000, 150_000),
      ],
    };
    expect(progress(s, '1y', TODAY).money!.headline).toBe(
      'Debt down $1,000.00 and savings up $500.00 since Oct 26, 2025',
    );
  });

  it('gives the latest check-in’s change when the headline does not already say it', () => {
    const NOV9 = '2026-11-09';
    const three = {
      ...base,
      moneyReviews: [
        review('2026-10-25', 530_000, 100_000),
        review('2026-11-01', 510_000, 150_000),
        review('2026-11-08', 500_000, 140_000),
      ],
    };
    const card = progress(three, '4w', NOV9).money!;
    expect(card.headline).toBe('Debt down $300.00 and savings up $400.00 since Oct 25');
    // Savings fell at the latest check-in although they rose over the range.
    expect(card.latest).toBe(
      'Latest check-in, Nov 8: debt −$100.00 and savings −$100.00 since Nov 1',
    );
    // With two check-ins in the range, the headline is that change.
    const two = { ...three, moneyReviews: three.moneyReviews.slice(1) };
    expect(progress(two, '4w', NOV9).money!.latest).toBeNull();
    // A balance not reported at the latest check-in has no latest change.
    const partial = {
      ...three,
      moneyReviews: [...three.moneyReviews.slice(0, 2), review('2026-11-08', 500_000, null)],
    };
    expect(progress(partial, '4w', NOV9).money!.latest).toBe(
      'Latest check-in, Nov 8: debt −$100.00 since Nov 1',
    );
    // The latest check-in outside the range: nothing to add.
    expect(progress(three, '4w', '2027-01-31').money!.latest).toBeNull();
  });

  it('one check-in is a figure; another currency is counted, never converted', () => {
    const one = { ...base, moneyReviews: [review('2026-10-12', 480_000, null)] };
    expect(progress(one, '12w', TODAY).money).toMatchObject({
      state: 'sparse',
      headline: 'Debt $4,800.00 on Oct 12',
      note: 'The next money check-in starts the lines.',
      savings: [],
    });
    const mixed = {
      ...base,
      moneyReviews: [review('2026-10-01', 300_000, 0, 'EUR'), review('2026-10-12', 480_000, null)],
    };
    expect(progress(mixed, '12w', TODAY).money).toMatchObject({
      otherCurrency: 1,
      currency: 'USD',
    });
    expect(progress(base, '12w', TODAY).money).toMatchObject({
      state: 'empty',
      headline: 'No money check-in in the last 12 weeks',
      note: 'Add a money check-in to start the lines.',
    });
    expect(progress(plan(routine('walk')), '12w', TODAY).money).toBeNull();
  });
});

describe('trading', () => {
  const profile = defaultTradingProfile('2026-09-01');
  const review = (date: string, kind: 'clean' | 'fail' | 'violation' | 'away'): RuleReview => ({
    id: `r-${date}`,
    date,
    at: at(date, 17),
    routineId: 'trade',
    occurrenceId: null,
    outcome: kind === 'away' ? 'none' : 'reviewed',
    answers:
      kind === 'away'
        ? []
        : profile.checklist.map((c, i) => ({
            checkpointId: c.id,
            answer: kind === 'fail' && i === 2 ? ('no' as const) : ('yes' as const),
          })),
    violations: kind === 'violation' ? ['hard-1'] : [],
    note: '',
    trading: {
      session: kind === 'away' ? 'away' : 'traded',
      entries: null,
      failedTheses: null,
      ownCandle: true,
    },
  });
  const s: State = {
    ...withDays(
      plan(routine('trade', { capture: 'rules', weekdays: [1, 2, 3, 4, 5] })),
      day('2026-10-15', [block('2026-10-15', 'trade', 'planned')]),
    ),
    ruleBooks: [
      {
        id: 'book',
        routineId: 'trade',
        title: 'Trading',
        checkpoints: [],
        rules: [],
        updatedAt: at('2026-09-01'),
        trading: profile,
      },
    ],
    ruleReviews: [
      review('2026-09-14', 'clean'),
      review('2026-09-22', 'clean'),
      review('2026-09-23', 'fail'),
      review('2026-09-24', 'violation'),
      review('2026-09-25', 'away'),
      review('2026-10-16', 'clean'),
    ],
  };

  it('plots the process score of each reviewed session, clean ones marked', () => {
    const data = progress(s, '4w', TODAY);
    expect(data.trading!.points).toEqual([
      { date: '2026-09-22', y: 8, clean: true, violations: 0 },
      { date: '2026-09-23', y: 7, clean: false, violations: 0 },
      // 8 of 8 with a hard violation is rule-broken.
      { date: '2026-09-24', y: 8, clean: false, violations: 1 },
      { date: '2026-10-16', y: 8, clean: true, violations: 0 },
    ]);
    expect(data.trading).toMatchObject({
      total: 8,
      clean: 2,
      missed: 1,
      // The tile has the rule-clean sessions, the hard violations and the latest score; the card
      // says where the scores went. (8 + 7 + 8 + 8) / 4 against Sep 14's 8.
      headline: 'Process score averaged 7.8 of 8 in the last 4 weeks, down from 8',
    });
    // Rule-clean sessions lead, with the hard violations recorded; an 8 of 8 with a violation
    // never reads as the figure.
    expect(tile(data, 'trading')).toMatchObject({
      label: 'Rule-clean sessions',
      value: '2 of 4',
      detail: '1 hard violation recorded · last score 8/8',
      delta: 1,
      change: '+1 vs previous 4 weeks',
    });
    // The sparkline counts rule-clean sessions, as the figure does.
    expect(tile(data, 'trading').spark.reduce((sum, p) => sum + p.y, 0)).toBe(2);
  });

  it('without a review in the range the tile and card say what fills them', () => {
    const data = progress(s, '4w', '2026-12-31');
    expect(tile(data, 'trading')).toMatchObject({
      value: null,
      empty: 'Review a trading session to start the count.',
    });
    expect(data.trading).toMatchObject({ state: 'empty', points: [] });
    expect(progress(plan(routine('walk')), '4w', TODAY).tiles.map((t) => t.id)).toEqual([
      'streak',
      'cleared',
    ]);
  });

  it('a process paused in Programs has no tile or card until it is resumed, its reviews kept', () => {
    const paused: State = {
      ...s,
      programs: s.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) => ({ ...r, enabled: false })),
      })),
    };
    const data = progress(paused, '4w', TODAY);
    expect(data.trading).toBeNull();
    expect(data.tiles.map((t) => t.id)).toEqual(['streak', 'cleared']);
    expect(paused.ruleReviews).toEqual(s.ruleReviews);
    expect(progress(s, '4w', TODAY).trading!.points).toHaveLength(4);
  });
});

describe('habits', () => {
  const routines = [
    routine('walk'),
    routine('stretch', { optional: true }),
    routine('journal', { private: true }),
    routine('step', { bundledInto: 'walk' }),
    routine('swim'),
  ];
  const s = withDays(
    plan(...routines),
    day('2026-10-12', [
      block('2026-10-12', 'walk', 'done'),
      block('2026-10-12', 'stretch', 'done', { optional: true }),
      block('2026-10-12', 'journal', 'done'),
    ]),
    day('2026-10-13', [
      block('2026-10-13', 'walk', 'skipped'),
      block('2026-10-13', 'stretch', 'planned', { optional: true }),
      block('2026-10-13', 'journal', 'done'),
    ]),
    day('2026-10-14', [block('2026-10-14', 'walk', 'done')]),
    day('2026-10-15', [block('2026-10-15', 'walk', 'done')]),
  );

  it('lists required habits most done first, then the optional ones, marked', () => {
    // A walk left open on the 16th is a miss; the skip on the 13th is excused, not due.
    const missed = withDays(s, day('2026-10-16', [block('2026-10-16', 'walk', 'planned')]));
    const card = progress(missed, '4w', TODAY).habits!;
    expect(card.rows.map((r) => [r.routineId, r.done, r.due, r.share, r.optional])).toEqual([
      ['journal', 2, 2, 100, false],
      // The habit that slipped stays readable in the bars, under the steadiest.
      ['walk', 3, 4, 75, false],
      // Optional: below every required habit, never the top bar.
      ['stretch', 1, 2, 50, true],
    ]);
    expect(card.rows.find((r) => r.routineId === 'journal')!.private).toBe(true);
    // The headline names the steadiest required habit, never an optional one and never the one
    // that slipped, and that habit is the top bar.
    expect(card.headline).toBe('Journal: done on 2 of 2 days');
    expect(card.rows[0].title).toBe('Journal');
    expect(card.state).toBe('chart');
    // Once the journal is left open on a day, the walk is the steadiest and leads instead.
    const even = withDays(
      missed,
      day('2026-10-14', [
        block('2026-10-14', 'walk', 'done'),
        block('2026-10-14', 'journal', 'planned'),
      ]),
    );
    expect(progress(even, '4w', TODAY).habits!.headline).toBe('Walk: done on 3 of 4 days');
  });

  it('never leads with a zero: nothing required done yet says so without a count', () => {
    const none = withDays(
      plan(routine('walk'), routine('stretch', { optional: true })),
      day('2026-10-15', [
        block('2026-10-15', 'walk', 'planned'),
        block('2026-10-15', 'stretch', 'done', { optional: true }),
      ]),
      day('2026-10-16', [block('2026-10-16', 'walk', 'planned')]),
    );
    const card = progress(none, '4w', TODAY).habits!;
    expect(card.headline).toBe('No required habit done yet in the last 4 weeks');
    expect(card.rows.map((r) => [r.routineId, r.done, r.due])).toEqual([
      ['walk', 0, 2],
      ['stretch', 1, 1],
    ]);
  });

  it('never counts a skip as a miss, as Consistency and Day Cleared excuse it', () => {
    // Walk is done on every day it was not skipped: 3 of 3, never 3 of 4.
    const data = progress(s, '4w', TODAY);
    expect(data.habits!.rows.find((r) => r.routineId === 'walk')).toMatchObject({
      done: 3,
      due: 3,
      share: 100,
    });
    // Habits and Consistency add up the same required objectives.
    const habits = data.habits!.rows.filter((r) => !r.optional);
    const week = data.consistency!.weeks.find((w) => w.weekStart === '2026-10-12')!;
    expect(habits.reduce((n, r) => n + r.done, 0)).toBe(week.done);
    expect(habits.reduce((n, r) => n + r.due, 0)).toBe(week.total);
  });

  it('reads a bundled routine from the steps in its parent, as Day Cleared counts them', () => {
    // The workout is done every day, its bundled knee rehab step left open: no day clears.
    const gym = plan(
      routine('workout', { checklist: false, duration: 60 }),
      routine('knees', { bundledInto: 'habits', title: 'Knee rehab' }),
      routine('ankles', { bundledInto: 'habits', title: 'Ankles', optional: true }),
    );
    const workout = (date: string, knees: Block['status'], ankles: Block['status']) =>
      day(date, [
        block(date, 'workout', 'done', {
          bundledSteps: [
            {
              id: `${date}:bundled:knees`,
              routineId: 'knees',
              programId: 'habits',
              title: 'Knee rehab',
              steps: [],
              status: knees,
              actualAt: knees === 'planned' ? null : at(date, 19),
            },
            {
              id: `${date}:bundled:ankles`,
              routineId: 'ankles',
              programId: 'habits',
              title: 'Ankles',
              steps: [],
              status: ankles,
              actualAt: ankles === 'done' ? at(date, 19) : null,
              optional: true,
            },
          ],
        }),
      ]);
    const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
    const state = withDays(
      gym,
      ...days.map((d, i) => workout(d, i === 4 ? 'done' : 'planned', i < 2 ? 'done' : 'planned')),
    );
    for (const d of days.slice(0, 4)) expect(dayOutcome(state, d)).toBe('open');
    const card = progress(state, '4w', TODAY).habits!;
    expect(card.rows.map((r) => [r.routineId, r.done, r.due, r.optional])).toEqual([
      ['knees', 1, 5, false],
      // The workout only hosts bundled steps: a container, never a habit of its own.
      ['ankles', 2, 5, true],
    ]);
    expect(card.headline).toBe('Knee rehab: done on 1 of 5 days');
  });

  it('never names a container as a habit, whatever its own check says', () => {
    // Every bundled step is done and the workout's own check is left open or skipped: each day
    // clears, so Habits says every required habit was done.
    const gym = plan(
      routine('workout', { checklist: false, duration: 60 }),
      routine('knees', { bundledInto: 'habits', title: 'Knee rehab' }),
    );
    const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
    const state = withDays(
      gym,
      ...days.map((date, i) =>
        day(date, [
          block(date, 'workout', i % 2 ? 'skipped' : 'planned', {
            bundledSteps: [
              {
                id: `${date}:bundled:knees`,
                routineId: 'knees',
                programId: 'habits',
                title: 'Knee rehab',
                steps: [],
                status: 'done',
                actualAt: at(date, 19),
              },
            ],
          }),
        ]),
      ),
    );
    for (const d of days) expect(dayOutcome(state, d)).toBe('cleared');
    const card = progress(state, '4w', TODAY).habits!;
    expect(card.rows.map((r) => [r.routineId, r.done, r.due])).toEqual([['knees', 5, 5]]);
    expect(card.headline).toBe(
      'Every required habit done on all its recorded days in the last 4 weeks',
    );
    // A focus line on the workout itself still reads its own check, which was never ticked.
    const workout = gym.programs.flatMap((p) => p.routines).find((r) => r.id === 'workout')!;
    expect(recordedDays(state, workout, days[0], TODAY)).toEqual({ done: 0, due: 5 });
  });

  it('says when every required habit was done, or only optional ones were recorded', () => {
    const all = withDays(plan(routine('walk')), cleared('2026-10-12'));
    expect(progress(all, '4w', TODAY).habits!.headline).toBe(
      'Every required habit done on all its recorded days in the last 4 weeks',
    );
    const optional = withDays(
      plan(routine('stretch', { optional: true })),
      day('2026-10-12', [block('2026-10-12', 'stretch', 'done', { optional: true })]),
    );
    expect(progress(optional, '4w', TODAY).habits!.headline).toBe(
      'Only optional habits were recorded in the last 4 weeks',
    );
  });
});

describe('memoized per saved state', () => {
  it('returns the same result for the same state, range and day, and recomputes otherwise', () => {
    const s = withDays(plan(routine('walk')), cleared(TODAY));
    const first = progressOf(s, '12w', TODAY);
    expect(progressOf(s, '12w', TODAY)).toBe(first);
    expect(progressOf(s, '4w', TODAY)).not.toBe(first);
    expect(progressOf(s, '12w', '2026-10-18')).not.toBe(first);
    const next = withDays(s, missed('2026-10-16'));
    expect(progressOf(next, '12w', TODAY)).not.toBe(first);
    expect(progressOf(next, '12w', TODAY)).toEqual(progress(next, '12w', TODAY));
  });
});

describe('two years of history', () => {
  const state = twoYears();

  it('the streak walk gives the streak through every date, with each date’s outcome', () => {
    const runs = dayClearRuns(state, LONG_TODAY, LONG_TODAY);
    expect(runs).toHaveLength(Object.keys(state.days).length);
    for (const run of runs.filter((_, i) => i % 29 === 0 || i === runs.length - 1)) {
      expect({ current: run.current, best: run.best }).toEqual(
        dayClearStreak(state, run.date, LONG_TODAY),
      );
      expect(run.outcome).toBe(dayOutcome(state, run.date));
    }
  });

  it('counts every routine’s recorded days in one pass exactly as one at a time', () => {
    const routines = state.programs.flatMap((p) => p.routines);
    const from = shiftDate(LONG_TODAY, -200);
    const optional = new Set(routines.filter((r) => r.optional).map((r) => r.id));
    const all = recordedDaysOf(state, routines, from, LONG_TODAY, LONG_TODAY, optional);
    for (const r of routines)
      expect(all.get(r.id)).toEqual(
        recordedDays(state, r, from, LONG_TODAY, LONG_TODAY, optional.has(r.id)),
      );
    expect([...all.values()].some((c) => c.due > 0)).toBe(true);
  });

  it('folds a year of tile sparklines into four-week spans: about a dozen points', () => {
    const data = progress(state, '1y', LONG_TODAY);
    for (const t of data.tiles) {
      expect(t.spark.length).toBeGreaterThan(1);
      expect(t.spark.length).toBeLessThanOrEqual(13);
      t.spark.forEach((p, i) => {
        expect(daysBetween(data.window.from, p.date) % 28).toBe(0);
        if (i) expect(p.date > t.spark[i - 1].date).toBe(true);
      });
    }
    // The cleared days add up to the tile's figure; the streak ends where the tile says it is.
    const cleared = tile(data, 'cleared');
    expect(cleared.spark.reduce((a, p) => a + p.y, 0)).toBe(Number(cleared.value!.split(' ')[0]));
    expect(tile(data, 'streak').spark.at(-1)!.y).toBe(
      dayClearStreak(state, LONG_TODAY, LONG_TODAY).current,
    );
    // Twelve weeks stay one point a week.
    expect(tile(progress(state, '12w', LONG_TODAY), 'streak').spark).toHaveLength(12);
  });

  it('gives the reference counts for every range, quickly', () => {
    const book = tradingBook(state)!;
    const read = tradingDayReader(state, book);
    // The demo's trading process is paused, so Progress leaves its tile and card out until it is
    // resumed; resumed, every reviewed session is read.
    const resumed: State = {
      ...state,
      programs: state.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) => (r.id === book.routineId ? { ...r, enabled: true } : r)),
      })),
    };
    for (const range of ['4w', '12w', '1y'] as const) {
      const started = Date.now();
      const data = progress(state, range, LONG_TODAY);
      // A coarse tripwire, not a benchmark: only a return to quadratic work would cross it.
      expect(Date.now() - started).toBeLessThan(5_000);
      // Reference: one date at a time, with the Day Cleared rule.
      let cleared = 0;
      let counted = 0;
      let reviewed = 0;
      for (let d = data.window.from; d <= LONG_TODAY; d = shiftDate(d, 1)) {
        const outcome = dayOutcome(state, d);
        const open =
          d === LONG_TODAY && dayProgress(state.days[d], state.programs, d).remaining > 0;
        if (outcome === 'cleared') cleared++;
        if (outcome === 'cleared' || (outcome === 'open' && !open)) counted++;
        const status = read(d, LONG_TODAY).status;
        if (status === 'clean' || status === 'broken') reviewed++;
      }
      expect(tile(data, 'cleared').value).toBe(`${cleared} of ${counted}`);
      const { current } = dayClearStreak(state, LONG_TODAY, LONG_TODAY);
      expect(tile(data, 'streak').value).toBe(`${current} ${current === 1 ? 'day' : 'days'}`);
      expect(data.trading).toBeNull();
      expect(progress(resumed, range, LONG_TODAY).trading!.points).toHaveLength(reviewed);
      expect(data.consistency!.weeks).toHaveLength(data.window.weeks);
    }
    expect(Object.keys(state.days).length).toBeGreaterThan(DAYS);
  });
});
