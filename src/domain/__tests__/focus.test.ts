import { describe, expect, it } from '@jest/globals';
import { compareCheckpoints, comparisonLine, saveCheckpoint } from '../checkpoints';
import { demoState } from '../demo';
import { DEMO } from '../demo-catalog';
import {
  FocusInput,
  activeFocus,
  defaultReviewDate,
  editFocus,
  endFocus,
  focusDay,
  nextAction,
  pastFocuses,
  restartNote,
  startFocus,
} from '../focus';
import { focusEvidence, moneyLine } from '../focus-evidence';
import { State, shiftDate } from '../model';
import { setStatus } from '../planner';
import { withDay } from '../data';
import { studyStreak } from '../study-streak';
import { cleanStreak, saveTradingReview, tradingBook } from '../trading';

// Synthetic: the fictional demo's six weeks, treated as a device with history.
const TODAY = '2026-11-09';
const NOW = new Date(2026, 10, 9, 9).toISOString();
const later = (h: number) => new Date(2026, 10, 9, h).toISOString();

const base = (): State => {
  const s = demoState(TODAY);
  return { ...s, source: 'personal', focuses: [], weeklyReviews: [], skillCheckpoints: [] };
};
const input = (extra: Partial<FocusInput> = {}): FocusInput => ({
  title: 'Interview readiness',
  goalId: 'demo-career',
  outcome: 'Solve new medium problems in time',
  evidence: 'career',
  routineIds: [DEMO.study, DEMO.careerStep],
  leadRoutineId: DEMO.study,
  cue: 'If I put it off after dinner, I open the course and start one problem.',
  baseline: '',
  target: '',
  reviewDate: defaultReviewDate(TODAY),
  ...extra,
});

describe('the 90-day focus', () => {
  it('starts today, ends 90 days later by default, and is the only active one', () => {
    const s = startFocus(base(), input(), 'f1', NOW);
    const f = activeFocus(s)!;
    expect(f.startDate).toBe(TODAY);
    expect(f.reviewDate).toBe('2027-02-07');
    expect(focusDay(f, TODAY)).toEqual({ day: 1, of: 90, due: false });
    expect(() => startFocus(s, input({ title: 'Debt' }), 'f2', NOW)).toThrow(/current focus first/);
  });

  it('replacing archives the active focus and keeps it readable', () => {
    let s = startFocus(base(), input(), 'f1', NOW);
    s = startFocus(s, input({ title: 'Save for a trip', evidence: 'money' }), 'f2', later(10), {
      replace: true,
    });
    expect(activeFocus(s)?.id).toBe('f2');
    expect(pastFocuses(s).map((f) => [f.id, f.status, f.endedAt])).toEqual([
      ['f1', 'archived', later(10)],
    ]);
  });

  it('edits keep the start and history; completing ends it; passing the review date changes nothing', () => {
    let s = startFocus(base(), input(), 'f1', NOW);
    s = editFocus(
      s,
      'f1',
      input({ title: 'Ready for interviews', reviewDate: '2027-03-01' }),
      later(11),
    );
    expect(activeFocus(s)).toMatchObject({
      title: 'Ready for interviews',
      startDate: TODAY,
      createdAt: NOW,
    });
    const f = activeFocus(s)!;
    expect(focusDay(f, '2027-03-05')).toMatchObject({ due: true });
    expect(activeFocus(s)?.status).toBe('active');
    s = endFocus(s, 'f1', 'completed', later(12));
    expect(activeFocus(s)).toBeUndefined();
    expect(s.focuses[0]).toMatchObject({ status: 'completed', endedAt: later(12) });
    expect(() => endFocus(s, 'f1', 'archived', later(13))).toThrow(/not active/);
  });

  it('refuses a missing title and a review date before the start; drops unknown routines', () => {
    expect(() => startFocus(base(), input({ title: ' ' }), 'f1', NOW)).toThrow(/Name the priority/);
    expect(() => startFocus(base(), input({ reviewDate: '2026-11-01' }), 'f1', NOW)).toThrow(
      /on or after/,
    );
    const s = startFocus(
      base(),
      input({ routineIds: [DEMO.study, 'gone'], leadRoutineId: 'gone' }),
      'f1',
      NOW,
    );
    expect(activeFocus(s)).toMatchObject({ routineIds: [DEMO.study], leadRoutineId: null });
  });

  it('creates and moves nothing: days, programs and records stay exactly as they were', () => {
    const before = base();
    const s = startFocus(before, input(), 'f1', NOW);
    expect({ ...s, focuses: [] }).toEqual(before);
  });
});

describe('the next action', () => {
  it('is the lead objective while open, then the next linked one, then done; never invented', () => {
    let s = startFocus(base(), input(), 'f1', NOW);
    const f = activeFocus(s)!;
    const first = nextAction(s, f, TODAY);
    expect(first.kind === 'due' && first.routine.id).toBe(DEMO.study);
    const day = s.days[TODAY];
    s = withDay(s, setStatus(day, `${TODAY}:routine:${DEMO.study}`, 'done', later(20)));
    const second = nextAction(s, f, TODAY);
    expect(second.kind === 'due' && second.routine.id).toBe(DEMO.careerStep);
    s = withDay(
      s,
      setStatus(s.days[TODAY], `${TODAY}:routine:${DEMO.careerStep}`, 'skipped', later(20)),
    );
    expect(nextAction(s, f, TODAY).kind).toBe('done');
    // A day with nothing linked on it (or never opened) offers nothing.
    expect(nextAction(s, f, '2026-11-20').kind).toBe('none');
  });

  it('skips a paused linked routine', () => {
    let s = startFocus(base(), input(), 'f1', NOW);
    s = {
      ...s,
      programs: s.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) => (r.id === DEMO.study ? { ...r, enabled: false } : r)),
      })),
    };
    const next = nextAction(s, activeFocus(s)!, TODAY);
    expect(next.kind === 'due' && next.routine.id).toBe(DEMO.careerStep);
  });

  it('says a restart is today after a miss, without changing the record or the streaks', () => {
    const s = base();
    const study = s.programs.flatMap((p) => p.routines).find((r) => r.id === DEMO.study)!;
    // The demo studies Monday to Saturday: the last study day before Monday is Saturday.
    const yesterday = shiftDate(TODAY, -2);
    const missed = withDay(
      s,
      setStatus(s.days[yesterday], `${yesterday}:routine:${DEMO.study}`, 'skipped', later(8)),
    );
    expect(restartNote(missed, study, TODAY)).toBe(
      "Saturday didn't happen. Start fresh today; five minutes is a fine start.",
    );
    expect(restartNote(s, study, TODAY)).toBeNull();
    // Any other objective: the day is named plainly and today stands on its own, never "missed".
    const morning = s.programs.flatMap((p) => p.routines).find((r) => r.id === 'demo-morning')!;
    const sunday = shiftDate(TODAY, -1);
    const open = withDay(
      s,
      setStatus(s.days[sunday], `${sunday}:routine:${morning.id}`, 'skipped', later(8)),
    );
    expect(restartNote(open, morning, TODAY)).toBe(
      "Sunday didn't happen. Today counts on its own.",
    );
    // The note is read-only: the streak is the strict one, the day stays skipped.
    expect(studyStreak(missed, study, TODAY).current).toBe(0);
    expect(missed.days[yesterday].blocks.find((b) => b.routineId === DEMO.study)?.status).toBe(
      'skipped',
    );
  });

  it('after a rule-broken trading session asks for the process first, never a recovery trade', () => {
    const s = base();
    const trading = s.programs.flatMap((p) => p.routines).find((r) => r.id === DEMO.trading)!;
    const note = restartNote(s, trading, TODAY);
    // The demo's last session is clean, so nothing is said; the clean streak is untouched.
    expect(note).toBeNull();
    expect(cleanStreak(s, tradingBook(s)!, TODAY).current).toBeGreaterThan(0);
    // A correction that records a hard violation on Friday makes the note appear; history is not
    // touched by the note, and the session stays rule-broken.
    const answers = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`process-${i + 1}`, 'yes' as const]),
    );
    const broken = saveTradingReview(
      s,
      {
        date: '2026-11-06',
        routineId: DEMO.trading,
        session: 'traded',
        answers,
        violations: ['hard-4'],
        entries: 2,
        failedTheses: 1,
        note: '',
      },
      'unused',
      later(8),
    );
    expect(restartNote(broken, trading, TODAY)).toBe(
      'The last session broke a rule. Process first today; no recovery trades.',
    );
    expect(cleanStreak(broken, tradingBook(broken)!, TODAY).current).toBe(0);
  });
});

describe('focus evidence', () => {
  it('reads study consistency and checkpoints for a career focus, with no percentage', () => {
    const s = startFocus(base(), input(), 'f1', NOW);
    const lines = focusEvidence(s, activeFocus(s)!, TODAY, shiftDate(TODAY, -27));
    expect(lines.map((l) => l.label)).toEqual([
      'Coding practice',
      'Career step',
      'Skill checkpoints',
    ]);
    expect(lines[0].value).toMatch(/^\d+ of \d+ study days kept$/);
    expect(lines[2].value).toBe('No skill checkpoint recorded yet.');
    expect(lines.some((l) => /%/.test(l.value))).toBe(false);
  });

  it('reads actual debt from the first to the latest report, and says when nothing is reported', () => {
    const s = base();
    expect(moneyLine(s, 'debt', shiftDate(TODAY, -42), TODAY).value).toMatch(
      /^\$6,400\.00 \(.+\) → \$5,350\.00 \(.+\) · −\$1,050\.00$/,
    );
    expect(moneyLine({ ...s, moneyReviews: [] }, 'debt', TODAY, TODAY).value).toBe(
      'Not reported yet',
    );
  });

  it('reads trading process counts, never profit', () => {
    let s = startFocus(
      base(),
      input({ evidence: 'trading', routineIds: [DEMO.trading], leadRoutineId: null }),
      'f1',
      NOW,
    );
    const lines = focusEvidence(s, activeFocus(s)!, TODAY, shiftDate(TODAY, -30));
    expect(lines.map((l) => l.label)).toEqual(['Trading sessions', 'Hard violations']);
    expect(lines[0].value).toMatch(/clean · \d+ rule-broken/);
    expect(lines[1].value).toBe('1');
    s = { ...s };
  });

  it('reads workouts, the main lift and weight for a training focus', () => {
    const s = startFocus(
      base(),
      input({ evidence: 'training', routineIds: [], leadRoutineId: null }),
      'f1',
      NOW,
    );
    const lines = focusEvidence(s, activeFocus(s)!, TODAY, shiftDate(TODAY, -42));
    const labels = lines.map((l) => l.label);
    expect(labels[0]).toBe('Workouts finished');
    expect(labels).toContain('Body weight');
    expect(lines.find((l) => l.label.endsWith('heaviest set'))?.value).toMatch(/lb .* → .* lb/);
  });
});

describe('skill checkpoints', () => {
  const at = later(19);
  const record = (s: State, id: string, date: string, extra: object = {}) =>
    saveCheckpoint(
      s,
      {
        date,
        method: 'Course site, new problems',
        difficulty: 'medium',
        attempted: 4,
        solved: 1,
        minutes: 60,
        fresh: true,
        topics: '',
        next: '',
        ...extra,
      },
      id,
      at,
    );

  it('compares only under the same conditions on new problems', () => {
    let s = record(base(), 'k1', '2026-10-01');
    expect(compareCheckpoints(s).kind).toBe('single');
    s = record(s, 'k2', '2026-11-01', { solved: 3 });
    expect(comparisonLine(compareCheckpoints(s))).toMatch(
      /^1 of 4 on .+ → 3 of 4 on .+, same conditions/,
    );
    // Different conditions stand alone.
    const harder = record(s, 'k3', '2026-11-05', { difficulty: 'hard', solved: 1 });
    expect(compareCheckpoints(harder).kind).toBe('single');
    // Repeated problems never make a trend.
    const seen = record(s, 'k3', '2026-11-05', { fresh: false, solved: 4 });
    expect(comparisonLine(compareCheckpoints(seen))).toMatch(/Repeated problems test memory/);
  });

  it('timed study minutes never count as a checkpoint, and corrections keep the first save', () => {
    const s = base();
    expect(s.activitySessions.some((a) => a.study)).toBe(true);
    expect(compareCheckpoints(s).kind).toBe('none');
    let r = record(s, 'k1', '2026-11-01');
    r = saveCheckpoint(r, { ...r.skillCheckpoints[0], solved: 2, id: 'k1' }, 'unused', later(21));
    expect(r.skillCheckpoints).toHaveLength(1);
    expect(r.skillCheckpoints[0]).toMatchObject({ solved: 2, at });
    expect(() => record(s, 'k9', '2026-12-01')).toThrow(/today or an earlier day/);
    expect(() => record(s, 'k9', '2026-11-01', { solved: 5 })).toThrow(/from 0 to/);
  });
});

describe('focus forms, closed windows and time limits', () => {
  it('saving a form seeded from a stored focus never writes back its start, status or history', () => {
    let s = startFocus(base(), input(), 'f1', NOW);
    const stored = activeFocus(s)!;
    const stale = { ...stored, status: 'archived', startDate: '2020-01-01', createdAt: later(1) };
    s = editFocus(s, 'f1', stale as unknown as FocusInput, later(11));
    expect(activeFocus(s)).toMatchObject({ status: 'active', startDate: TODAY, createdAt: NOW });
    expect(Object.keys(activeFocus(s)!).sort()).toEqual(Object.keys(stored).sort());
    s = endFocus(s, 'f1', 'archived', later(12));
    expect(() => editFocus(s, 'f1', input(), later(13))).toThrow(/Only the active focus/);
  });

  it('counts an optional study occurrence done today as a kept study day', () => {
    let s = startFocus(base(), input(), 'f1', NOW);
    const day = s.days[TODAY];
    const study = day.blocks.find((b) => b.routineId === DEMO.study)!;
    s = withDay(s, {
      ...day,
      blocks: day.blocks.map((b) => (b.id === study.id ? { ...b, optional: true } : b)),
    });
    s = withDay(s, setStatus(s.days[TODAY], study.id, 'done', later(20)));
    const [line] = focusEvidence(s, activeFocus(s)!, TODAY, TODAY, TODAY);
    expect(line.value).toBe('1 of 1 study days kept');
  });

  it('reads evidence for a closed window that ends before today', () => {
    const s = startFocus(base(), input(), 'f1', NOW);
    const week = focusEvidence(s, activeFocus(s)!, TODAY, '2026-11-02', '2026-11-08');
    // The demo's protected sick day in that week holds: it is neither kept nor missed.
    const [, kept, scored] = week[0].value.match(/^(\d) of (\d) study days kept/)!;
    expect(Number(kept)).toBeLessThanOrEqual(Number(scored));
    expect(Number(scored)).toBeLessThanOrEqual(7);
    expect(week[1].value).toMatch(/^Done on \d of 4 recorded days$/);
  });

  it('says so when a checkpoint time limit is over a day', () => {
    expect(() =>
      saveCheckpoint(
        base(),
        {
          date: '2026-11-01',
          method: 'Set',
          difficulty: 'easy',
          attempted: 2,
          solved: 1,
          minutes: 2000,
          fresh: true,
          topics: '',
          next: '',
        },
        'k1',
        NOW,
      ),
    ).toThrow(/1 to 1440 minutes/);
  });
});
