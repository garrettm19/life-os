import { describe, expect, it } from '@jest/globals';
import { decodeState } from '../data';
import { dayListOrder, dayOrderEntries } from '../day-order';
import { DEMO_DAYS, demoState } from '../demo';
import { DEMO, DEMO_GOALS, DEMO_ROTATION } from '../demo-catalog';
import { dateObject, shiftDate } from '../model';
import { dayOutcome, objectiveLeaves } from '../objectives';
import { nextWorkout } from '../rotation';
import { undoWorkout } from '../workouts';
import { todayWidgetTimeline } from '../widget';
import { studyStreak } from '../study-streak';
import { cleanStreak, profitLimit, tradingBook, tradingDayReader } from '../trading';

// Each weekday as today, so no event depends on which day the demo is opened.
const TODAYS = Array.from({ length: 7 }, (_, i) => shiftDate('2026-11-09', i));
const ORDER = DEMO_ROTATION;

describe.each(TODAYS)('the demo opened on %s', (TODAY: string) => {
  const state = demoState(TODAY);
  const routines = state.programs.flatMap((p) => p.routines);
  const dates = Object.keys(state.days).sort();

  it('is deterministic, valid, and labeled as a demo', () => {
    expect(JSON.stringify(demoState(TODAY))).toBe(JSON.stringify(state));
    expect(decodeState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(state.source).toBe('demo');
    expect(dates[0]).toBe(shiftDate(TODAY, -DEMO_DAYS));
    expect(dates.at(-1)).toBe(TODAY);
  });

  it('builds for every weekday and across both daylight-saving changes', () => {
    for (let i = 0; i < 7; i++) expect(() => demoState(shiftDate(TODAY, i))).not.toThrow();
    for (const day of ['2026-11-01', '2026-11-02', '2027-03-14', '2027-03-15', '2027-01-01'])
      expect(() => decodeState(JSON.parse(JSON.stringify(demoState(day))))).not.toThrow();
  });

  it('has a rotation, a circuit, companions, a bundled step, alternation and optional objectives, all untimed, with fictional IDs only', () => {
    expect(routines.every((r) => r.id.startsWith('demo-'))).toBe(true);
    const gym = state.programs.find((p) => p.id === DEMO.gym)!;
    expect(gym.rotation?.order).toEqual(ORDER);
    expect(ORDER.map((id) => routines.find((r) => r.id === id)!.title)).toEqual([
      'Chest / Triceps / Shoulders A',
      'Back / Biceps A',
      'Legs A',
      'Chest / Triceps / Shoulders B',
      'Back / Biceps B',
      'Legs B',
    ]);
    expect(state.workoutTemplates.map((t) => t.routineId).sort()).toEqual([...ORDER].sort());
    expect(state.intervalRoutines).toHaveLength(1);
    expect(routines.filter((r) => r.follows?.length).map((r) => r.id)).toEqual([
      DEMO.core,
      DEMO.neck,
    ]);
    expect(routines.find((r) => r.id === DEMO.knees)?.bundledInto).toBe(DEMO.gym);
    expect(routines.find((r) => r.id === DEMO.mobility)?.alternate?.variants).toHaveLength(2);
    expect(routines.find((r) => r.id === DEMO.weighIn)?.optional).toBe(true);
    expect(routines.find((r) => r.id === DEMO.project)?.optional).toBe(true);
    expect(routines.find((r) => r.id === DEMO.careerStep)?.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(routines.find((r) => r.id === DEMO.money)?.weekdays).toEqual([0]);
    expect(routines.find((r) => r.id === DEMO.home)?.weekdays).toEqual([6]);
    expect(routines.every((r) => r.preferredStart === null)).toBe(true);
    expect(tradingBook(state)?.trading?.checklist).toHaveLength(8);
  });

  it('shows the whole life inventory without turning it into a daily checklist', () => {
    // Twelve life goals, each served by a program or noted in the life log; none invented away.
    expect(state.goals.map((g) => g.id)).toEqual(DEMO_GOALS.map((g) => g.id));
    const served = new Set([
      ...state.programs.flatMap((p) => p.goalIds),
      ...state.lifeLog.map((e) => e.goalId),
    ]);
    for (const goal of state.goals) {
      expect(served.has(goal.id)).toBe(true);
      expect(goal.desiredState.length).toBeGreaterThan(40);
    }
    for (const p of state.programs)
      for (const id of p.goalIds) expect(state.goals.some((g) => g.id === id)).toBe(true);
    // Scheduling context (waking, meals, sleep, grooming, social life) never becomes an objective.
    const forbidden =
      /wake|shower|breakfast|sleep|meal|calorie|skincare|groom|hair|date|dating|friend|social|confiden|emotion|mood/i;
    for (const r of routines) expect(r.title).not.toMatch(forbidden);
    // Today stays realistic on every weekday: at most seven required objectives.
    for (let i = 0; i < 7; i++) {
      const day = shiftDate(TODAY, i);
      const s = i ? demoState(day) : state;
      const required = objectiveLeaves(s.days[day], s.programs).filter((l) => !l.optional);
      expect(required.length).toBeGreaterThanOrEqual(4);
      expect(required.length).toBeLessThanOrEqual(7);
      expect(new Set(required.map((l) => l.routineId)).size).toBe(required.length);
    }
    // Scheduling context, not objectives: office hours and an eight-hour sleep window.
    expect(state.settings).toMatchObject({ wake: 450, bedtime: 1410, workStart: 540 });
    expect(state.settings.bedtime - state.settings.wake).toBeLessThanOrEqual(24 * 60 - 8 * 60);
  });

  it('keeps trading paused: history kept, no objective since, nothing missed', () => {
    const trading = routines.find((r) => r.id === DEMO.trading)!;
    expect(trading.enabled).toBe(false);
    expect(trading.private).toBe(true);
    const program = state.programs.find((p) => p.routines.includes(trading))!;
    expect(program.group).toBe('Paused');
    expect(program.goalIds).not.toContain('demo-money');
    const pausedFrom = shiftDate(TODAY, -6);
    for (const d of dates.filter((x) => x >= pausedFrom))
      expect(state.days[d].blocks.some((b) => b.routineId === DEMO.trading)).toBe(false);
    expect(state.ruleReviews.every((r) => r.date < pausedFrom)).toBe(true);
    const book = tradingBook(state)!;
    const tradingDay = tradingDayReader(state, book);
    for (const d of dates.filter((x) => x >= pausedFrom))
      expect(tradingDay(d, TODAY).status).toBe('none');
    expect(book.trading!.limits.map((l) => l.label)).toEqual(
      expect.arrayContaining(['Maximum risk per thesis', 'Maximum daily loss', 'Failed theses']),
    );
    // No profit ceiling or dollar target: a dollar figure is never a quota.
    expect(book.trading!.limits.some(profitLimit)).toBe(false);
    // Its sessions never report more entries than its example limit.
    expect(
      state.ruleReviews.every((r) => (r.trading?.entries ?? 0) <= book.trading!.maxEntries!),
    ).toBe(true);
  });

  it('records a life outside the objectives in the life log, dated in the past', () => {
    expect(state.lifeLog.length).toBeGreaterThanOrEqual(10);
    expect(state.lifeLog.every((e) => e.date < TODAY)).toBe(true);
    const categories = new Set(state.lifeLog.map((e) => e.category));
    for (const c of ['social', 'health', 'career', 'reflection', 'general'])
      expect(categories.has(c as never)).toBe(true);
    expect(new Set(state.lifeLog.map((e) => e.id)).size).toBe(state.lifeLog.length);
    // Pickleball with friends is recorded as the cardio it was.
    expect(state.activitySessions.some((a) => a.activity === 'Pickleball')).toBe(true);
  });

  it('records the accessories inside a workout on their own, never from the workout', () => {
    const withAccessories = dates.flatMap((d) =>
      state.days[d].blocks.filter((b) => b.bundledSteps?.some((s) => s.routineId === DEMO.knees)),
    );
    expect(withAccessories.length).toBeGreaterThan(4);
    for (const block of withAccessories) expect(ORDER).toContain(block.routineId);
    expect(
      withAccessories.some(
        (b) => b.status === 'done' && b.bundledSteps!.some((s) => s.status === 'skipped'),
      ),
    ).toBe(true);
  });

  it('records nothing after today and nothing today', () => {
    const records = [
      ...state.measurements,
      ...state.workoutSessions,
      ...state.moneyReviews,
      ...state.intervalSessions,
      ...state.activitySessions,
      ...state.ruleReviews,
    ];
    expect(records.length).toBeGreaterThan(100);
    expect(records.every((r) => r.date < TODAY)).toBe(true);
    expect(state.days[TODAY].blocks.every((b) => b.status === 'planned')).toBe(true);
  });

  it('advances the rotation by completed workouts only, through a skip and a rest day', () => {
    const done = dates.flatMap((d) =>
      state.days[d].blocks
        .filter((b) => ORDER.includes(b.routineId as never) && b.status === 'done')
        .map((b) => b.routineId!),
    );
    expect(done.length).toBeGreaterThan(20);
    done.forEach((id, i) => expect(id).toBe(ORDER[i % ORDER.length]));
    const skipped = dates.flatMap((d) =>
      state.days[d].blocks.filter(
        (b) => ORDER.includes(b.routineId as never) && b.status === 'skipped',
      ),
    );
    expect(skipped).toHaveLength(1);
    expect(dates.some((d) => state.days[d].rotation?.some((o) => o.mode === 'rest'))).toBe(true);
    expect(
      nextWorkout(
        state,
        state.programs.find((p) => p.id === DEMO.gym)!,
        TODAY,
      ),
    ).toBe(ORDER[done.length % ORDER.length]);
    // Logged sets carry loads that rise over the six weeks.
    const bench = state.workoutSessions
      .filter((s) => s.routineId === DEMO.chestA)
      .map((s) => s.exercises[0].sets[0].load!);
    expect(bench.at(-1)!).toBeGreaterThan(bench[0]);
  });

  it('keeps companions separate: the circuit follows chest days, moved once on its own', () => {
    const moved = dates.flatMap((d) =>
      state.days[d].blocks.filter((b) => b.routineId === DEMO.core && b.movedFrom),
    );
    expect(moved).toHaveLength(1);
    for (const s of state.intervalSessions) {
      const day = state.days[s.date];
      const block = day.blocks.find((b) => b.id === s.occurrenceId)!;
      const chestThatDay = day.blocks.some(
        (b) => b.routineId === DEMO.chestA || b.routineId === DEMO.chestB,
      );
      expect(chestThatDay || !!block.movedFrom).toBe(true);
    }
  });

  it('lists the day in a sensible order: the morning first, the weekly resets last', () => {
    expect(dayOrderEntries(state.programs).map((e) => e.title)).toEqual([
      'Morning',
      'Morning weigh-in',
      'Mobility',
      'Career step',
      'Coding practice',
      'Portfolio project',
      'Strength',
      'Ab circuit',
      'Neck',
      'Easy cardio',
      'Home reset',
      'Money check-in',
    ]);
    const today = state.days[TODAY].blocks;
    expect(dayListOrder(today, state.programs).at(0)?.routineId).toBe(DEMO.morning);
  });

  it('names the morning in plain words, with no times or amounts', () => {
    const morning = state.programs.flatMap((p) => p.routines).find((r) => r.id === DEMO.morning)!;
    expect(morning.title).toBe('Morning');
    expect(morning.steps).toEqual(['Walk', 'Sunlight', 'Water', 'Supplements']);
  });

  it('alternates mobility by calendar day', () => {
    const titles = dates
      .map((d) => state.days[d].blocks.find((b) => b.routineId === DEMO.mobility)?.title)
      .filter(Boolean);
    titles.slice(1).forEach((t, i) => expect(t).not.toBe(titles[i]));
  });

  it('scores study and trading only from their start, with honest misses', () => {
    const study = routines.find((r) => r.id === DEMO.study)!;
    const streak = studyStreak(state, study, TODAY);
    expect(streak.since).toBe(shiftDate(TODAY, -35));
    expect(streak.current).toBeGreaterThan(0);
    expect(streak.best).toBeGreaterThanOrEqual(streak.current);
    const book = tradingBook(state)!;
    const tradingDay = tradingDayReader(state, book);
    const statuses = dates.filter((d) => d < TODAY).map((d) => tradingDay(d, TODAY).status);
    expect(statuses).toEqual(expect.arrayContaining(['clean', 'broken', 'away', 'held']));
    expect(state.ruleReviews.every((r) => r.date >= book.trading!.since)).toBe(true);
    expect(cleanStreak(state, book, TODAY).current).toBeGreaterThan(0);
  });

  it('has cleared days and honest open days, and one protected day', () => {
    const past = dates.filter((d) => d < TODAY).map((d) => dayOutcome(state, d));
    expect(past).toContain('cleared');
    expect(past).toContain('open');
    expect(past.filter((o) => o === 'protected')).toHaveLength(1);
  });

  it('records weights, cardio minutes and money check-ins, with gaps left as gaps', () => {
    expect(state.measurements.length).toBeGreaterThan(25);
    expect(state.measurements.length).toBeLessThan(DEMO_DAYS);
    const cardio = state.activitySessions.filter((a) => a.routineId === DEMO.cardio);
    expect(cardio.every((a) => [0, 3].includes(dateObject(a.date).getDay()))).toBe(true);
    expect(state.moneyReviews.every((m) => dateObject(m.date).getDay() === 0)).toBe(true);
    expect(state.moneyReviews.length).toBe(5);
    const debt = state.moneyReviews.map((m) => m.debt!);
    expect(debt.at(-1)!).toBeLessThan(debt[0]);
  });

  it('re-derives the rotation after a past workout is undone, touching no other day', () => {
    const gym = state.programs.find((p) => p.id === DEMO.gym)!;
    const last = [...dates]
      .reverse()
      .find((d) =>
        state.days[d].blocks.some(
          (b) => ORDER.includes(b.routineId as never) && b.status === 'done',
        ),
      )!;
    const block = state.days[last].blocks.find(
      (b) => ORDER.includes(b.routineId as never) && b.status === 'done',
    )!;
    const edited = undoWorkout(state, last, block.id);
    expect(nextWorkout(edited, gym, TODAY)).toBe(block.routineId);
    for (const d of dates.filter((x) => x !== last)) expect(edited.days[d]).toEqual(state.days[d]);
    // The logged sets stay with the reopened session.
    expect(edited.workoutSessions).toHaveLength(state.workoutSessions.length);
  });

  it('shows no private objective on the widget', () => {
    const widget = JSON.stringify(todayWidgetTimeline(state, new Date(`${TODAY}T12:00:00`)));
    for (const r of routines.filter((x) => x.private)) expect(widget).not.toContain(r.title);
  });

  it('shows one active focus, a past weekly review and comparable checkpoints, all fictional', () => {
    expect(state.focuses).toHaveLength(1);
    expect(state.focuses[0]).toMatchObject({
      status: 'active',
      startDate: shiftDate(TODAY, -27),
      routineIds: [DEMO.study, DEMO.careerStep],
    });
    expect(state.weeklyReviews).toHaveLength(2);
    for (const review of state.weeklyReviews) {
      expect(review.focusId).toBe(state.focuses[0].id);
      expect(review.weekStart < TODAY).toBe(true);
    }
    expect(state.skillCheckpoints).toHaveLength(3);
    expect(state.skillCheckpoints.every((c) => c.date < TODAY)).toBe(true);
  });
});
