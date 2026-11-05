import { describe, expect, it } from '@jest/globals';
import { occurrenceText } from '../alternation';
import { encodeBackup, parseBackup } from '../backup';
import { decodeState } from '../data';
import { demoState } from '../demo';
import { DEMO, DEMO_ROTATION } from '../demo-catalog';
import { Routine, State, dateObject, shiftDate } from '../model';
import { dayClearStreak, dayProgress, streakHistory } from '../objectives';
import { inRepeatWeek } from '../repeat';
import { ensureDay, nextWorkout } from '../rotation';
import { startTracking } from '../start-tracking';
import { studyStreak } from '../study-streak';
import { cleanStreak, tradingBook } from '../trading';
import { basicState } from '../../test-support/basic-state';

// Start tracking turns the demo into the device's own plan: every definition kept, every record of
// the fictional six weeks cleared, and nothing dated before the day tracking starts.

const at = (date: string, hour: number) => {
  const d = dateObject(date);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const routinesOf = (s: State) => s.programs.flatMap((p) => p.routines);
const routine = (s: State, id: string) => routinesOf(s).find((r) => r.id === id)!;

/** The plan and definitions; every other list in the state is a record of what happened. */
const DEFINITIONS = new Set([
  'goals',
  'programs',
  'notes',
  'workoutTemplates',
  'intervalRoutines',
  'ruleBooks',
]);

// A training day (Monday) and a default rest day (Wednesday) of the demo's rotation.
describe.each(['2026-11-09', '2026-11-11'])('starting to track on %s', (TODAY: string) => {
  const demo = demoState(TODAY);
  const now = at(TODAY, 10);
  const state = startTracking(demo, TODAY, now);

  it('is the personal state, valid as saved and as a backup', () => {
    expect(state.source).toBe('personal');
    expect(state.version).toBe(5);
    expect(decodeState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    const backup = parseBackup(encodeBackup(state, now));
    expect(backup.state).toEqual(state);
  });

  it('keeps every goal, program, routine, workout plan, circuit and rulebook', () => {
    expect(state.goals).toEqual(demo.goals);
    expect(state.settings).toEqual(demo.settings);
    expect(state.notes).toEqual(demo.notes);
    expect(state.programs.map((p) => p.id)).toEqual(demo.programs.map((p) => p.id));
    expect(routinesOf(state).map((r) => r.id)).toEqual(routinesOf(demo).map((r) => r.id));
    // Only the dates in a routine change; titles, steps, links, weekdays and pauses are the demo's.
    const undated = (r: Routine) => ({ ...r, alternate: undefined, study: undefined });
    expect(routinesOf(state).map(undated)).toEqual(routinesOf(demo).map(undated));
    expect(state.programs.map((p) => p.rotation)).toEqual(demo.programs.map((p) => p.rotation));
    const timeless = <T extends { updatedAt: string }>(list: T[]) =>
      list.map((x) => ({ ...x, updatedAt: '' }));
    expect(timeless(state.workoutTemplates)).toEqual(timeless(demo.workoutTemplates));
    expect(timeless(state.intervalRoutines)).toEqual(timeless(demo.intervalRoutines));
    const book = tradingBook(state)!;
    const demoBook = tradingBook(demo)!;
    expect(book.rules).toEqual(demoBook.rules);
    expect(book.checkpoints).toEqual(demoBook.checkpoints);
    expect({ ...book.trading, since: '' }).toEqual({ ...demoBook.trading, since: '' });
    expect(book.trading!.limits.length).toBeGreaterThan(0);
    // Trading practice stays paused, as it was in the demo.
    expect(routine(state, DEMO.trading).enabled).toBe(false);
  });

  it('clears every record of the six weeks', () => {
    expect(state.days).toEqual({});
    const lists = Object.entries(state).filter(([, v]) => Array.isArray(v));
    expect(lists.length).toBeGreaterThan(DEFINITIONS.size);
    for (const [key, list] of lists)
      if (!DEFINITIONS.has(key)) expect([key, list]).toEqual([key, []]);
    // The demo had something in each of them.
    for (const [key] of lists)
      if (!DEFINITIONS.has(key))
        expect((demo[key as keyof State] as unknown[]).length).toBeGreaterThan(0);
  });

  it('keeps no date before today', () => {
    // Local dates, and instants (ISO, in UTC) no earlier than the start of the local day.
    const found = JSON.stringify(state).match(/\d{4}-\d{2}-\d{2}(T[^"]+)?/g) ?? [];
    expect(found.length).toBeGreaterThan(0);
    const dayStart = Date.parse(at(TODAY, 0));
    for (const value of found)
      expect([value, value.includes('T') ? Date.parse(value) >= dayStart : value >= TODAY]).toEqual(
        [value, true],
      );
  });

  it('starts the trading process and the study streak today', () => {
    expect(tradingBook(state)!.trading!.since).toBe(TODAY);
    const study = routine(state, DEMO.study);
    expect(study.study!.trackFrom).toBe(TODAY);
    expect(study.study!.schedule).toEqual([
      { from: TODAY, weekdays: [...study.weekdays!].sort((a, b) => a - b), enabled: true },
    ]);
    expect(studyStreak(state, study, TODAY)).toMatchObject({
      current: 0,
      best: 0,
      since: TODAY,
      later: false,
    });
  });

  it('keeps the mobility alternation on the same variant each day', () => {
    const before = routine(demo, DEMO.mobility);
    const after = routine(state, DEMO.mobility);
    expect(after.alternate!.anchor >= TODAY).toBe(true);
    for (let i = 0; i < 14; i++) {
      const date = shiftDate(TODAY, i);
      expect(occurrenceText(after, date)).toEqual(occurrenceText(before, date));
    }
  });

  it('restarts the rotation at its first workout', () => {
    const gym = state.programs.find((p) => p.id === DEMO.gym)!;
    expect(nextWorkout(state, gym, TODAY)).toBe(DEMO_ROTATION[0]);
    const opened = ensureDay(state, TODAY, now);
    const workouts = opened.days[TODAY].blocks.filter((b) =>
      DEMO_ROTATION.includes(b.routineId ?? ''),
    );
    const restDay = gym.rotation!.restDays.includes(dateObject(TODAY).getDay());
    expect(workouts.map((b) => b.routineId)).toEqual(restDay ? [] : [DEMO_ROTATION[0]]);
  });

  it("shows today's due objectives once Today opens, with every streak at a fresh start", () => {
    expect(dayClearStreak(state, TODAY, TODAY)).toEqual({ current: 0, best: 0 });
    expect(streakHistory(state, TODAY, TODAY)).toEqual([]);
    expect(cleanStreak(state, tradingBook(state)!, TODAY)).toEqual({ current: 0, best: 0 });
    const opened = ensureDay(state, TODAY, now);
    expect(Object.keys(opened.days)).toEqual([TODAY]);
    const day = opened.days[TODAY];
    expect(day.blocks.every((b) => b.status === 'planned')).toBe(true);
    // The same weekday objectives the demo had today; only the rotation's place differs.
    const managed = new Set([...DEMO_ROTATION, DEMO.core, DEMO.neck, DEMO.knees]);
    const plain = (s: State) =>
      s.days[TODAY].blocks
        .map((b) => b.routineId!)
        .filter((id) => !managed.has(id))
        .sort();
    expect(plain(opened)).toEqual(plain(demo));
    expect(plain(opened).length).toBeGreaterThanOrEqual(3);
    const progress = dayProgress(day, opened.programs, TODAY);
    expect(progress.total).toBeGreaterThan(0);
    expect(progress.remaining).toBe(progress.total);
    expect(dayClearStreak(opened, TODAY, TODAY)).toEqual({ current: 0, best: 0 });
    expect(studyStreak(opened, routine(opened, DEMO.study), TODAY).current).toBe(0);
  });
});

describe('start tracking', () => {
  const TODAY = '2026-11-09';
  const now = at(TODAY, 10);

  it('keeps the device settings: the widget opt-in and the timer cue', () => {
    const demo = demoState(TODAY);
    demo.settings = { ...demo.settings, widgetDayStatus: true, timerCue: 'beep' };
    expect(startTracking(demo, TODAY, now).settings).toEqual(demo.settings);
  });

  it('drops the last backup time, since a backup of the demo holds none of the new records', () => {
    const demo = demoState(TODAY);
    demo.settings = { ...demo.settings, lastBackupAt: at(TODAY, 9) };
    const { lastBackupAt: _, ...rest } = demo.settings;
    const settings = startTracking(demo, TODAY, now).settings;
    expect(settings.lastBackupAt).toBeUndefined();
    expect(settings).toEqual(rest);
  });

  it('keeps the same weeks for a routine that repeats every few weeks', () => {
    const demo = demoState(TODAY);
    for (const anchor of [shiftDate(TODAY, -40), shiftDate(TODAY, -9), shiftDate(TODAY, 20)]) {
      const withRepeat: State = {
        ...demo,
        programs: demo.programs.map((p) => ({
          ...p,
          routines: p.routines.map((r) =>
            r.id === DEMO.morning ? { ...r, repeat: { everyWeeks: 3, anchor } } : r,
          ),
        })),
      };
      const before = routine(withRepeat, DEMO.morning);
      const after = routine(startTracking(withRepeat, TODAY, now), DEMO.morning);
      expect(after.repeat!.anchor >= TODAY).toBe(true);
      for (let i = 0; i < 84; i++) {
        const date = shiftDate(TODAY, i);
        expect([date, inRepeatWeek(after, date)]).toEqual([date, inRepeatWeek(before, date)]);
      }
    }
  });

  it('applies only to the demo', () => {
    const personal = { ...basicState(), source: 'personal' as const };
    expect(() => startTracking(personal, TODAY, now)).toThrow('Only the demo');
  });
});
