import { describe, expect, it } from '@jest/globals';
import { withDay } from '../data';
import { demoState } from '../demo';
import { State, shiftDate } from '../model';
import { ensureChecklistDay, setStatus } from '../planner';
import {
  STREAK_MARKS,
  clearedByWeek,
  dayMoments,
  journey,
  startedOn,
  weekHeadline,
  liftBests,
  moneyMoment,
  streakMoment,
  streakStep,
  weekMarks,
} from '../moments';
import { dayClearStreak, dayOutcome, protectDay } from '../objectives';

// Fictional demo data only. Monday, November 9, 2026 is "today".
const TODAY = '2026-11-09';
const demo = demoState(TODAY);
const past = Object.keys(demo.days)
  .filter((d) => d < TODAY)
  .sort();

describe('moments come only from records', () => {
  it('a lift best beats every earlier session, and a first session is never a best', () => {
    const firstDay = demo.workoutSessions.map((s) => s.date).sort()[0];
    expect(liftBests(demo, firstDay)).toEqual([]);
    const bests = past.flatMap((d) => liftBests(demo, d).map((m) => ({ d, m })));
    expect(bests.length).toBeGreaterThan(0);
    for (const { d, m } of bests) {
      const [, , load] = m.title.match(/^(.*) (\d+(?:\.\d+)?) lb$/)!;
      const earlier = demo.workoutSessions
        .filter((s) => s.status === 'completed' && s.date < d)
        .flatMap((s) => s.exercises.filter((e) => m.title.startsWith(e.name)))
        .flatMap((e) => e.sets.filter((s) => s.done).map((s) => s.load ?? 0));
      expect(earlier.length).toBeGreaterThan(0);
      expect(Math.max(...earlier)).toBeLessThan(Number(load));
      expect(m.detail).toMatch(/^Heaviest yet, up from \d+ lb$/);
    }
  });

  it('an unfinished session or an undone set never makes a best', () => {
    const date = past.find((d) => liftBests(demo, d).length)!;
    const unfinished: State = {
      ...demo,
      workoutSessions: demo.workoutSessions.map((s) =>
        s.date === date ? { ...s, status: 'active' as const } : s,
      ),
    };
    expect(liftBests(unfinished, date)).toEqual([]);
    const undone: State = {
      ...demo,
      workoutSessions: demo.workoutSessions.map((s) =>
        s.date === date
          ? {
              ...s,
              exercises: s.exercises.map((e) => ({
                ...e,
                sets: e.sets.map((x) => ({ ...x, done: false })),
              })),
            }
          : s,
      ),
    };
    expect(liftBests(undone, date)).toEqual([]);
  });

  it('a streak moment needs a cleared day at a round number or a new best', () => {
    for (const d of past) {
      const m = streakMoment(demo, d, TODAY);
      if (dayOutcome(demo, d) !== 'cleared') {
        expect(m).toBeNull();
        continue;
      }
      const { current } = dayClearStreak(demo, d, TODAY);
      const earlierBest = dayClearStreak(demo, shiftDate(d, -1), TODAY).best;
      const expected =
        STREAK_MARKS.includes(current) || (current > earlierBest && earlierBest >= 3);
      expect(!!m).toBe(expected);
      if (m) expect(m.title).toBe(`${current}-day streak`);
    }
  });

  it('a money moment needs debt down or savings up against the review before', () => {
    const dates = demo.moneyReviews.map((r) => r.date).sort();
    // The first review has nothing to compare with.
    expect(moneyMoment(demo, dates[0])).toBeNull();
    const later = moneyMoment(demo, dates.at(-1)!)!;
    expect(later.title).toMatch(/^Debt down \$\d/);
    expect(later.detail).toMatch(/down since|^Since /);
    // Debt going up is never celebrated.
    const worse: State = {
      ...demo,
      moneyReviews: demo.moneyReviews.map((r) =>
        r.date === dates.at(-1) ? { ...r, debt: 9_999_00, savings: 0 } : r,
      ),
    };
    expect(moneyMoment(worse, dates.at(-1)!)).toBeNull();
    expect(moneyMoment(demo, TODAY)).toBeNull();
  });

  it('a day with nothing worth noticing says nothing', () => {
    const open = past.find(
      (d) => dayOutcome(demo, d) === 'open' && !dayMoments(demo, d, TODAY).length,
    );
    expect(open).toBeDefined();
  });

  it('a second session the same day is compared with earlier days, never with this morning', () => {
    const date = past.find((d) => liftBests(demo, d).length)!;
    const [best] = liftBests(demo, date);
    const morning = demo.workoutSessions.find((s) => s.date === date && s.status === 'completed')!;
    const heavier = (n: number) => ({
      ...morning,
      id: `${morning.id}:evening`,
      occurrenceId: `${morning.occurrenceId}:evening`,
      startedAt: new Date(Date.parse(morning.startedAt) + 3_600_000).toISOString(),
      exercises: morning.exercises.map((e) => ({
        ...e,
        sets: e.sets.map((x) => ({ ...x, load: x.load === null ? null : x.load + n })),
      })),
    });
    const twice: State = { ...demo, workoutSessions: [...demo.workoutSessions, heavier(5)] };
    const again = liftBests(twice, date).find((m) => m.id === best.id)!;
    // Still measured from before today, and the heavier evening set is today's best.
    expect(again.detail).toBe(best.detail);
    expect(Number(again.title.match(/(\d+) lb$/)![1])).toBe(
      Number(best.title.match(/(\d+) lb$/)![1]) + 5,
    );
  });

  it('money from another currency is never compared', () => {
    const dates = demo.moneyReviews.map((r) => r.date).sort();
    const euros: State = {
      ...demo,
      moneyReviews: demo.moneyReviews.map((r) =>
        r.date === dates.at(-1) ? { ...r, currency: 'EUR' } : r,
      ),
    };
    expect(moneyMoment(euros, dates.at(-1)!)).toBeNull();
  });

  it('tells a new best from a tie', () => {
    const cleared = past.filter((d) => dayOutcome(demo, d) === 'cleared');
    for (const d of cleared) {
      const step = streakStep(demo, d, TODAY);
      expect(step.bestBefore).toBe(dayClearStreak(demo, shiftDate(d, -1), TODAY).best);
    }
  });

  it('the streak step counts into the day, then through it', () => {
    const d = past.filter((x) => dayOutcome(demo, x) === 'cleared').at(-1)!;
    const step = streakStep(demo, d, TODAY);
    expect(step.after).toBe(dayClearStreak(demo, d, TODAY).current);
    expect(step.after).toBeGreaterThanOrEqual(1);
    expect(step.before).toBe(step.after - 1);
  });
});

describe('the week', () => {
  it('reads the seven days ending on the day, with the one Day Cleared rule', () => {
    const week = weekMarks(demo, TODAY, TODAY);
    expect(week.map((d) => d.date)).toEqual(
      Array.from({ length: 7 }, (_, i) => shiftDate(TODAY, i - 6)),
    );
    // Monday, November 9 is last: the letters run Tuesday to Monday.
    expect(week.map((d) => d.letter).join('')).toBe('TWTFSSM');
    expect(week.at(-1)).toMatchObject({ date: TODAY, today: true, mark: 'open' });
    for (const d of week.slice(0, -1))
      expect(d.mark).toBe(
        ({ cleared: 'cleared', protected: 'protected', open: 'missed' } as Record<string, string>)[
          dayOutcome(demo, d.date)
        ] ?? 'none',
      );
    // A day viewed in the past shows no "later" days; a future one does.
    expect(
      weekMarks(demo, shiftDate(TODAY, 3), TODAY)
        .slice(-3)
        .map((d) => d.mark),
    ).toEqual(['later', 'later', 'later']);
  });

  it('a protected day is held, a day with nothing due is free, a never-opened day is neutral', () => {
    const day = past.find((d) => dayOutcome(demo, d) === 'open')!;
    const held = withDay(demo, protectDay(demo.days[day], 'illness'));
    expect(weekMarks(held, day, TODAY).at(-1)!.mark).toBe('protected');
    const free: State = {
      ...demo,
      days: { ...demo.days, [day]: { date: day, blocks: [], revisions: [] } },
    };
    expect(weekMarks(free, day, TODAY).at(-1)!.mark).toBe('free');
    const blank: State = { ...demo, days: {} };
    expect(weekMarks(blank, TODAY, TODAY).map((d) => d.mark)).toEqual([
      'none',
      'none',
      'none',
      'none',
      'none',
      'none',
      'none',
    ]);
  });
});

describe('the long view', () => {
  it('sums what was recorded since the first record of each kind', () => {
    const items = journey(demo, TODAY);
    expect(items.map((h) => h.id)).toEqual(['cleared', 'workouts', 'debt', 'savings', 'weight']);
    const cleared = past.filter((d) => dayOutcome(demo, d) === 'cleared').length;
    expect(items[0].value).toBe(String(cleared));
    expect(items[1].value).toBe(
      String(demo.workoutSessions.filter((s) => s.status === 'completed').length),
    );
    expect(items[1].detail).toMatch(/ \d+ → \d+ lb$/);
    // The same lift as figures, for the scoreboard row.
    const lift = items[1].lift!;
    expect(items[1].detail).toBe(`${lift.name} ${lift.from} → ${lift.to} ${lift.unit}`);
    expect(lift.to).toBeGreaterThan(lift.from);
    expect(items[2].detail).toMatch(/^\$6,400\.00 → \$[\d,.]+ since /);
    // Body weight: the latest weigh-in, with the first one and its date, never called progress.
    const weights = demo.measurements
      .filter((m) => m.kind === 'body-weight' && m.date <= TODAY)
      .sort((a, b) => a.date.localeCompare(b.date));
    expect(items[4].value).toBe(`${weights.at(-1)!.entered.value} lb`);
    expect(items[4].detail).toMatch(new RegExp(`^${weights[0].entered.value} lb on `));
  });

  it('says nothing about a kind with no records, and nothing at all on an empty device', () => {
    const noMoney: State = { ...demo, moneyReviews: [] };
    expect(journey(noMoney, TODAY).map((h) => h.id)).toEqual(['cleared', 'workouts', 'weight']);
    // One weigh-in is not a long view yet.
    const oneWeight: State = { ...noMoney, measurements: noMoney.measurements.slice(0, 1) };
    expect(journey(oneWeight, TODAY).map((h) => h.id)).toEqual(['cleared', 'workouts']);
    expect(
      journey(
        { ...demo, days: {}, workoutSessions: [], moneyReviews: [], measurements: [] },
        TODAY,
      ),
    ).toEqual([]);
  });
});

describe('cleared days by week', () => {
  it('counts each Monday-to-Sunday week with the one rule, oldest first, this week last', () => {
    const weeks = clearedByWeek(demo, TODAY);
    expect(weeks).toHaveLength(6);
    expect(weeks.at(-1)).toMatchObject({ weekStart: TODAY, current: true, cleared: 0 });
    const total = weeks.reduce((n, w) => n + w.cleared, 0);
    const first = weeks[0].weekStart;
    expect(total).toBe(past.filter((d) => d >= first && dayOutcome(demo, d) === 'cleared').length);
    expect(weeks.every((w) => w.cleared >= 0 && w.cleared <= 7)).toBe(true);
  });
});

describe('the long view headline', () => {
  /** A synthetic run of days: each date cleared or opened and left. */
  function weeks(cleared: Record<string, boolean>): State {
    let s = demoState(TODAY);
    s = { ...s, days: {} };
    for (const [date, done] of Object.entries(cleared)) {
      const at = new Date(`${date}T20:00:00`).toISOString();
      let day = ensureChecklistDay(date, s.settings, s.programs, undefined, at);
      if (done)
        for (const b of day.blocks.filter((x) => x.checklist && !x.optional))
          day = setStatus(day, b.id, 'done', at);
      s = withDay(s, day);
    }
    return s;
  }
  const span = (from: string, n: number, done: (i: number) => boolean) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [shiftDate(from, i), done(i)]));

  it('starts with the first record of any kind', () => {
    expect(startedOn(demo, TODAY)).toBe(
      [...past, ...demo.measurements.map((m) => m.date)].sort()[0],
    );
    expect(
      startedOn(
        { ...demo, days: {}, workoutSessions: [], moneyReviews: [], measurements: [] },
        TODAY,
      ),
    ).toBeNull();
  });

  it('names a best week only against the user’s own earlier weeks', () => {
    // Three weeks from Monday, October 12: 2, then 3 cleared, then 5 last week.
    const s = weeks({
      ...span('2026-10-12', 7, (i) => i < 2),
      ...span('2026-10-19', 7, (i) => i < 3),
      ...span('2026-10-26', 7, () => false),
      ...span('2026-11-02', 7, (i) => i < 5),
    });
    expect(weekHeadline(s, TODAY)).toBe(
      '5 days cleared last week, your best week since you started.',
    );
    // Matching the best.
    const m = weeks({
      ...span('2026-10-19', 7, (i) => i < 5),
      ...span('2026-10-26', 7, () => false),
      ...span('2026-11-02', 7, (i) => i < 5),
    });
    expect(weekHeadline(m, TODAY)).toBe('5 days cleared last week, matching your best week.');
    // Below the best but up on the week before.
    const u = weeks({
      ...span('2026-10-19', 7, (i) => i < 6),
      ...span('2026-10-26', 7, (i) => i < 1),
      ...span('2026-11-02', 7, (i) => i < 3),
    });
    expect(weekHeadline(u, TODAY)).toBe('3 days cleared last week, up from 1 the week before.');
    // Below both: the count alone, never a comparison that falls.
    const d = weeks({
      ...span('2026-10-19', 7, (i) => i < 6),
      ...span('2026-10-26', 7, (i) => i < 4),
      ...span('2026-11-02', 7, (i) => i < 2),
    });
    expect(weekHeadline(d, TODAY)).toBe('2 days cleared last week.');
    // Up on an empty week: the count alone, never "up from 0".
    const z = weeks({
      ...span('2026-10-19', 7, (i) => i < 5),
      ...span('2026-10-26', 7, () => false),
      ...span('2026-11-02', 7, (i) => i < 3),
    });
    expect(weekHeadline(z, TODAY)).toBe('3 days cleared last week.');
    // The first week of records.
    expect(weekHeadline(weeks(span('2026-11-02', 7, (i) => i < 1)), TODAY)).toBe(
      '1 day cleared in your first week.',
    );
  });

  it('says nothing about a week with nothing cleared, or before a week has finished', () => {
    expect(weekHeadline(weeks(span('2026-11-02', 7, () => false)), TODAY)).toBeNull();
    expect(weekHeadline(weeks(span('2026-11-09', 1, () => true)), TODAY)).toBeNull();
    expect(weekHeadline({ ...demo, days: {} }, TODAY)).toBeNull();
  });
});
