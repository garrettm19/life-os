import { describe, expect, it } from '@jest/globals';
import { withDay } from '../data';
import { Routine, State } from '../model';
import { protectDay } from '../objectives';
import { ensureChecklistDay, setStatus } from '../planner';
import {
  MAX_REMINDERS,
  REMINDER_PREFIX,
  stageAlert,
  studyOpenOn,
  studyReminders,
} from '../reminders';
import { DSA_STUDY, advanceStudy, pauseStudy, startStudy } from '../study';
import { studyState } from '../../test-support/fixtures';

// Synthetic data only; clocks are built from local dates. Monday, November 9, 2026.
const MON = '2026-11-09';
const at = (date: string, hour: number, minute = 0) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute).getTime();
};
const EVERY = [0, 1, 2, 3, 4, 5, 6];

function withReminders(
  reminders: Partial<NonNullable<Routine['study']>['reminders']>,
  time: number | null = 19 * 60 + 30,
  change: Partial<Routine> = {},
): State {
  const state = studyState();
  return {
    ...state,
    programs: state.programs.map((p) => ({
      ...p,
      routines: p.routines.map((r) =>
        r.id === 'study'
          ? {
              ...r,
              ...change,
              study: { ...r.study!, at: time, reminders: { ...r.study!.reminders, ...reminders } },
            }
          : r,
      ),
    })),
  };
}
const study = (state: State) =>
  state.programs.flatMap((p) => p.routines).find((r) => r.id === 'study')!;
const opened = (state: State, date = MON) =>
  withDay(
    state,
    ensureChecklistDay(
      date,
      state.settings,
      state.programs,
      state.days[date],
      new Date(at(date, 8)).toISOString(),
    ),
  );
const blockId = `${MON}:routine:study`;
const mark = (state: State, status: 'done' | 'planned', hour = 10) =>
  withDay(
    state,
    setStatus(state.days[MON], blockId, status, new Date(at(MON, hour)).toISOString()),
  );

describe('the daily study reminder', () => {
  it('is never planned unless the user turned it on with a study time', () => {
    expect(studyReminders(studyState(), at(MON, 8))).toEqual([]);
    expect(studyReminders(withReminders({ start: true }, null), at(MON, 8))).toEqual([]);
    expect(
      studyReminders(withReminders({ start: true }, 19 * 60, { enabled: false }), at(MON, 8)),
    ).toEqual([]);
  });

  it('repeats weekly on every scheduled weekday at the study time, needing no app opens', () => {
    const list = studyReminders(withReminders({ start: true }), at(MON, 8));
    expect(list).toHaveLength(7);
    expect(list.every((r) => r.at === null)).toBe(true);
    expect(list.map((r) => r.weekly!.weekday)).toEqual(EVERY);
    expect(list[1]).toEqual({
      id: `${REMINDER_PREFIX}study:weekly:1`,
      title: 'Time to study',
      body: "Your Daily study objective is on today's plan.",
      at: null,
      weekly: { weekday: 1, hour: 19, minute: 30 },
    });
    const weekdays = studyReminders(
      withReminders({ start: true }, 7 * 60, { weekdays: [1, 3, 5] }),
      at(MON, 8),
    );
    expect(weekdays.map((r) => r.weekly)).toEqual([
      { weekday: 1, hour: 7, minute: 0 },
      { weekday: 3, hour: 7, minute: 0 },
      { weekday: 5, hour: 7, minute: 0 },
    ]);
  });

  it('is identical however often it is planned the same day (no duplicates)', () => {
    const state = withReminders({ start: true });
    expect(studyReminders(state, at(MON, 8))).toEqual(studyReminders(state, at(MON, 12)));
  });

  it('a new time keeps the same identifiers, so it replaces rather than adds', () => {
    const before = studyReminders(withReminders({ start: true }, 19 * 60), at(MON, 8));
    const after = studyReminders(withReminders({ start: true }, 6 * 60 + 45), at(MON, 8));
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after[0].weekly).toEqual({ weekday: 0, hour: 6, minute: 45 });
  });

  it('keeps the same seven weekly repeats on a settled day: reliable, never expiring', () => {
    const base = opened(withReminders({ start: true }));
    const expected = studyReminders(base, at(MON, 8));
    // Done, Undo or a protected day never removes a weekday or adds one-off requests.
    const done = mark(base, 'done');
    expect(studyReminders(done, at(MON, 10))).toEqual(expected);
    expect(studyReminders(mark(done, 'planned'), at(MON, 11))).toEqual(expected);
    const protectedDay = withDay(base, protectDay(base.days[MON], 'illness'));
    expect(studyReminders(protectedDay, at(MON, 10))).toEqual(expected);
    expect(expected.every((r) => r.weekly && r.at === null)).toBe(true);
    // A week later, or months later, without the app being opened: the same requests.
    expect(studyReminders(base, at('2027-05-10', 8))).toEqual(expected);
  });

  it('stays far below the iOS limit of 64 pending requests', () => {
    // Every weekday, both reminders: 7 weekly repeats and at most 7 evening one-offs.
    const list = studyReminders(withReminders({ start: true, evening: 21 * 60 }), at(MON, 8));
    expect(list.filter((r) => r.weekly)).toHaveLength(7);
    expect(list.filter((r) => !r.weekly)).toHaveLength(7);
    expect(list.length).toBeLessThanOrEqual(14);
  });

  it('never names a private objective on the lock screen', () => {
    const list = studyReminders(
      withReminders({ start: true, evening: 21 * 60 }, 19 * 60, { private: true }),
      at(MON, 8),
    );
    expect(list.every((r) => !`${r.title} ${r.body}`.includes('Daily study'))).toBe(true);
    expect(list[0].body).toBe("Your study objective is on today's plan.");
  });
});

describe('the evening reminder', () => {
  it('covers each still-open day of the coming week only, at the chosen local time', () => {
    const state = opened(withReminders({ evening: 21 * 60 }));
    const list = studyReminders(state, at(MON, 8));
    expect(list).toHaveLength(7);
    expect(list[0]).toMatchObject({
      id: `${REMINDER_PREFIX}study:${MON}:evening`,
      title: 'Study still open',
      at: at(MON, 21),
      weekly: null,
    });
    const done = mark(state, 'done', 20);
    expect(studyOpenOn(done, study(done), MON)).toBe(false);
    expect(studyReminders(done, at(MON, 20)).some((r) => r.id.includes(MON))).toBe(false);
  });

  it('keeps local times across the November clock change', () => {
    // Sunday, November 1, 2026 is the US clock change; each evening stays at 21:00 local.
    const list = studyReminders(withReminders({ evening: 21 * 60 }), at('2026-10-29', 8));
    expect(list.map((r) => new Date(r.at!).getHours())).toEqual([21, 21, 21, 21, 21, 21, 21]);
  });

  it('skips a day the study was moved away from, and stays under the iOS pending limit', () => {
    const state = withReminders({ start: true, evening: 21 * 60 });
    const moved = withDay(state, {
      date: MON,
      blocks: [],
      revisions: [],
      moved: [{ routineId: 'study', to: '2026-11-10', at: new Date(at(MON, 7)).toISOString() }],
    });
    expect(studyReminders(moved, at(MON, 8)).some((r) => r.id.endsWith(`${MON}:evening`))).toBe(
      false,
    );
    expect(studyReminders(state, at(MON, 8), 90)).toHaveLength(MAX_REMINDERS);
  });
});

describe('the stage-end alert', () => {
  const target = { routineId: 'study', date: MON, blockId };
  it('fires when the running stage reaches its time, and only while it runs', () => {
    const routine = study(withReminders({ stageEnd: true }));
    const run = startStudy(DSA_STUDY, target, at(MON, 19));
    expect(stageAlert(run, routine, at(MON, 19, 5))).toMatchObject({
      at: at(MON, 19, 25),
      weekly: null,
      title: 'Learn and implement · time is up',
    });
    expect(stageAlert(pauseStudy(run, at(MON, 19, 5)), routine, at(MON, 19, 6))).toBeNull();
    expect(stageAlert(run, routine, at(MON, 20))).toBeNull();
    expect(stageAlert(advanceStudy(run, at(MON, 19, 30)), routine, at(MON, 19, 30))!.at).toBe(
      at(MON, 20),
    );
  });
});

describe('the stage-end alert of a private routine', () => {
  const target = { routineId: 'study', date: MON, blockId };
  it('names no stage on the lock screen, in the title or the body', () => {
    const base = study(withReminders({ stageEnd: true }));
    const routine = { ...base, private: true };
    const run = startStudy(DSA_STUDY, target, at(MON, 19));
    const alert = stageAlert(run, routine, at(MON, 19, 5))!;
    const text = `${alert.title} ${alert.body}`;
    for (const stage of DSA_STUDY.stages) expect(text).not.toContain(stage.title);
    expect(alert).toMatchObject({
      title: 'Study stage complete',
      body: 'The next stage is ready. Open Life OS to start it.',
    });
    // The public routine still says what comes next.
    expect(stageAlert(run, base, at(MON, 19, 5))!.body).toContain(DSA_STUDY.stages[1].title);
  });
});
