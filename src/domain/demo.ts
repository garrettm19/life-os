import { recordActivity } from './activity';
import {
  DEMO,
  DEMO_GOALS,
  DEMO_ROTATION,
  demoCircuit,
  demoPrograms,
  demoRuleBook,
  demoTemplates,
} from './demo-catalog';
import { completeCircuit } from './intervals';
import { saveLog } from './lifelog';
import { recordWeight } from './measurements';
import { Block, LogCategory, State, dateObject, emptyState, shiftDate } from './model';
import { saveMoneyReview } from './money';
import { protectDay } from './objectives';
import { setBundledStatus, setStatus } from './planner';
import { applyCompanionMove, ensureDay, planCompanionMove, restDay } from './rotation';
import { upsertRoutine } from './routines';
import { advanceStudy, recordStudy, startStudy } from './study';
import { saveTradingReview } from './trading';
import { finishSession, startSession } from './workouts';
import { withDay } from './data';
import { withDemoDirection } from './demo-direction';

// Explore demo: a fictional person's six weeks, ending today. The history is replayed through the
// same functions the app uses when someone taps Done, logs a set or saves a review, so every record
// is one the app could have made, and it is deterministic: the same date always gives the same demo.
// The person works office hours, trains on a six-workout rotation, practices coding and takes a
// small career step on weekdays, checks money on Sundays and keeps a life outside the app (friends,
// pickleball, guitar, games, a trip), noted in the life log rather than as objectives. It includes the ordinary misses a real
// month has (a skipped workout, a rest day taken, a companion moved, a skipped study day, a busy
// day, a protected sick day, a missed money check-in, a rule-broken trading day) and the trading
// practice paused a week ago after a rule-broken stretch, so Progress shows honest charts. Nothing here
// comes from a real person's data.

export const DEMO_DAYS = 42;

/** Local `hour`:`minute` on a date, built from the local calendar so every time zone agrees. */
function at(date: string, hour: number, minute = 0): string {
  const d = dateObject(date);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

type Replay = {
  state: State;
  /** Days before today (1 = yesterday). */
  ago: number;
  date: string;
  sessions: number;
  restTaken: boolean;
  workoutSkipped: boolean;
  companionMoved: boolean;
  /** Trading days reviewed so far, to place the week's events on weekdays. */
  tradingDays: number;
  sickDay: boolean;
  homeSkipped: boolean;
  accessoriesSkipped: boolean;
};

const blocksOf = (r: Replay, routineId: string): Block[] =>
  r.state.days[r.date]?.blocks.filter((b) => b.routineId === routineId) ?? [];

const done = (r: Replay, block: Block, hour: number, minute = 0) => {
  r.state = withDay(
    r.state,
    setStatus(r.state.days[r.date], block.id, 'done', at(r.date, hour, minute)),
  );
};

const skip = (r: Replay, block: Block, hour: number) => {
  r.state = withDay(
    r.state,
    setStatus(r.state.days[r.date], block.id, 'skipped', at(r.date, hour)),
  );
};

const bundled = (
  r: Replay,
  block: Block,
  stepId: string,
  status: 'done' | 'skipped',
  hour: number,
) => {
  r.state = withDay(
    r.state,
    setBundledStatus(r.state.days[r.date], block.id, stepId, status, at(r.date, hour)),
  );
};

/** A life log note: what happened, not an objective. */
function log(
  r: Replay,
  category: LogCategory,
  text: string,
  extra: { energy?: number; mood?: number; goalId?: string } = {},
) {
  r.state = saveLog(
    r.state,
    {
      text,
      date: r.date,
      category,
      energy: extra.energy ?? null,
      mood: extra.mood ?? null,
      goalId: extra.goalId ?? null,
    },
    `demo-log-${r.date}-${r.state.lifeLog.filter((e) => e.date === r.date).length + 1}`,
    at(r.date, 21, 30),
  );
}

/** The day's workout: a full session with loads that creep up, a skip, or a rest day taken. */
function strength(r: Replay) {
  for (const block of r.state.days[r.date].blocks) {
    if (block.status !== 'planned' || !block.routineId) continue;
    if (!DEMO_ROTATION.includes(block.routineId)) continue;
    if (!r.restTaken && r.ago <= 27) {
      // A rest day taken on a training day after a poor night: the same workout stays next.
      r.restTaken = true;
      r.state = restDay(r.state, DEMO.gym, r.date, at(r.date, 7, 30));
      log(r, 'health', 'Slept badly. Took the rest day, walked instead, early night.', {
        energy: 2,
        goalId: 'demo-sleep',
      });
      return;
    }
    // The knee and ankle accessories inside the workout are recorded on their own.
    const accessories = block.bundledSteps?.find((step) => step.routineId === DEMO.knees);
    if (!r.workoutSkipped && r.ago <= 34) {
      // A missed workout: skipped, and the rotation does not move on.
      r.workoutSkipped = true;
      if (accessories) bundled(r, block, accessories.id, 'skipped', 21);
      skip(r, block, 21);
      return;
    }
    if (accessories) {
      // Skipped once on a day the workout itself was done: neither ever records the other.
      const skipIt = !r.accessoriesSkipped && r.ago <= 30;
      if (skipIt) r.accessoriesSkipped = true;
      bundled(r, block, accessories.id, skipIt ? 'skipped' : 'done', 18);
    }
    const startedAt = at(r.date, 17, 45);
    r.state = startSession(
      r.state,
      r.date,
      r.state.days[r.date].blocks.find((b) => b.id === block.id)!,
      startedAt,
    );
    const session = r.state.workoutSessions.find((s) => s.occurrenceId === block.id)!;
    const step = Math.floor(r.sessions / 6);
    const logged = {
      ...session,
      exercises: session.exercises.map((e) => ({
        ...e,
        sets: Array.from({ length: e.plan.sets }, (_, i) => ({
          reps: e.plan.repsMin + (i === 0 && step % 2 === 1 ? 1 : 0),
          load: e.plan.load ? e.plan.load + step * 5 : null,
          done: true,
        })),
      })),
    };
    r.state = finishSession(r.state, r.date, block.id, logged, at(r.date, 18, 45));
    r.sessions += 1;
  }
}

/** Companions at home: the ab circuit (moved once to the next day) and the neck routine. */
function companions(r: Replay) {
  for (const block of blocksOf(r, DEMO.core)) {
    if (block.status !== 'planned') continue;
    if (!r.companionMoved && r.ago <= 20 && r.ago > 1) {
      r.companionMoved = true;
      const to = shiftDate(r.date, 1);
      const plan = planCompanionMove(r.state, r.date, DEMO.core, to, r.date);
      r.state = applyCompanionMove(r.state, plan, at(r.date, 20), r.date);
      continue;
    }
    r.state = completeCircuit(r.state, {
      intervalId: 'circuit-demo-core',
      date: r.date,
      blockId: block.id,
      startedAt: at(r.date, 20),
      finishedAt: at(r.date, 20, 6),
      skipped: [],
    });
  }
  for (const block of blocksOf(r, DEMO.neck))
    if (block.status === 'planned') (r.ago % 10 === 6 ? skip : done)(r, block, 20);
}

/** Study: one tap most days, a timed session every third day, one skipped day. */
function study(r: Replay) {
  const [block] = blocksOf(r, DEMO.study);
  if (!block || block.status !== 'planned') return;
  if (r.ago === 12) return skip(r, block, 21);
  if (r.ago % 3 !== 0) return done(r, block, 20);
  const plan = r.state.programs.flatMap((p) => p.routines).find((x) => x.id === DEMO.study)!.study!;
  const start = Date.parse(at(r.date, 20));
  let run = startStudy(plan, { routineId: DEMO.study, date: r.date, blockId: block.id }, start);
  let clock = start;
  for (const stage of plan.stages) {
    clock += stage.minutes * 60_000;
    run = advanceStudy(run, clock);
  }
  r.state = recordStudy(
    r.state,
    run,
    { countAsDone: true },
    `demo-study-${r.date}`,
    at(r.date, 21),
  );
}

/** Weight: most mornings, drifting down slowly; a few mornings missed (never a zero). */
function weight(r: Replay) {
  const [block] = blocksOf(r, DEMO.weighIn);
  if (!block || r.ago % 5 === 3) return;
  const wiggle = (((r.ago * 7) % 5) - 2) * 0.2;
  const value = Math.round((176 + r.ago * 0.07 + wiggle) * 10) / 10;
  r.state = recordWeight(
    r.state,
    {
      value,
      unit: 'lb',
      date: r.date,
      fasted: true,
      note: '',
      occurrence: { date: r.date, blockId: block.id },
    },
    `demo-weight-${r.date}`,
    at(r.date, 7, 10),
  );
}

/** Easy cardio on rest days: a run or a ride midweek, pickleball with friends on Sundays. */
function cardio(r: Replay) {
  const [block] = blocksOf(r, DEMO.cardio);
  if (!block) return;
  if (r.ago % 11 === 5) return skip(r, block, 20);
  const sunday = dateObject(r.date).getDay() === 0;
  const activity = sunday ? 'Pickleball' : ['Easy run', 'Bike', 'Easy run'][r.ago % 3];
  r.state = recordActivity(
    r.state,
    {
      date: r.date,
      activity,
      minutes: sunday ? 75 : 25 + ((r.ago * 4) % 10),
      note: '',
      routineId: DEMO.cardio,
      occurrence: { date: r.date, blockId: block.id },
    },
    `demo-cardio-${r.date}`,
    at(r.date, 12, 15),
  );
}

/** Sundays: debt falls, savings grow; one Sunday is missed and stays unrecorded. */
function money(r: Replay) {
  const [block] = blocksOf(r, DEMO.money);
  if (!block || (r.ago >= 14 && r.ago < 21)) return;
  const week = Math.floor((DEMO_DAYS - r.ago) / 7);
  r.state = saveMoneyReview(
    r.state,
    {
      date: r.date,
      currency: 'USD',
      cash: 1_150_00 + ((week * 137) % 400) * 100,
      savings: 600_00 + week * 125_00,
      debt: 6_400_00 - week * 210_00,
      upcoming: null,
      contributed: null,
      savingsTarget: null,
      nextAction: r.ago < 7 ? 'Move an extra $50 into the trip fund' : '',
      note: '',
      goalId: null,
      occurrence: { date: r.date, blockId: block.id },
    },
    `demo-money-${r.date}`,
    at(r.date, 19),
  );
}

/**
 * Trading: mostly clean sessions, deliberate no-trade days, one day away and two broken days, until
 * the practice is paused (`TRADING_PAUSED_AGO`). Paused days have no objective and are never missed.
 */
function trading(r: Replay, since: string) {
  const [block] = blocksOf(r, DEMO.trading);
  if (!block || r.date < since) return;
  const answers: Record<string, 'yes' | 'no'> = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`process-${i + 1}`, 'yes' as const]),
  );
  const n = r.tradingDays++;
  const away = n === 3;
  const noTrade = n % 4 === 1;
  const hard = n === 13;
  if (n === 8) answers['process-2'] = 'no';
  if (hard) answers['process-6'] = 'no';
  r.state = saveTradingReview(
    r.state,
    {
      date: r.date,
      routineId: DEMO.trading,
      session: away ? 'away' : noTrade ? 'no-trade' : 'traded',
      answers: away ? {} : answers,
      violations: hard ? ['hard-4'] : [],
      // One or two entries: never above the example limit of two.
      entries: away || noTrade ? 0 : 1 + (n % 2),
      failedTheses: hard ? 2 : away || noTrade ? 0 : n % 4 === 0 ? 1 : 0,
      note: hard ? 'Take the full reset before looking for another idea.' : '',
    },
    `demo-trading-${r.date}`,
    at(r.date, 16, 30),
  );
}

function plainDone(r: Replay) {
  for (const block of blocksOf(r, DEMO.morning))
    if (block.status === 'planned' && r.ago % 9 !== 4 && r.ago !== 2) done(r, block, 8);
  for (const block of blocksOf(r, DEMO.mobility))
    if (block.status === 'planned') (r.ago % 9 === 2 ? skip : done)(r, block, 8);
  for (const block of blocksOf(r, DEMO.careerStep))
    if (block.status === 'planned' && r.ago % 10 !== 5) done(r, block, 12, 30);
}

/** Saturdays: the home reset (skipped once), and the optional project when there is time. */
function weekend(r: Replay) {
  for (const block of blocksOf(r, DEMO.home)) {
    if (block.status !== 'planned') continue;
    if (!r.homeSkipped && r.ago <= 20) {
      r.homeSkipped = true;
      skip(r, block, 18);
    } else done(r, block, 11);
  }
  // Optional: left open on some Saturdays, which never blocks the day.
  for (const block of blocksOf(r, DEMO.project))
    if (block.status === 'planned' && r.ago % 14 < 7) done(r, block, 15);
}

/** Life outside the objectives: friends, sport, setbacks and good days, noted in the life log. */
function life(r: Replay) {
  const weekday = dateObject(r.date).getDay();
  const once: Record<number, Parameters<typeof log>> = {
    33: [
      r,
      'social',
      'Dinner with an old friend I had not seen in months.',
      { mood: 4, goalId: 'demo-friends' },
    ],
    26: [
      r,
      'reflection',
      'Rough day at work. Walked, called my sister, did the minimum and stopped there.',
      { mood: 2, energy: 3, goalId: 'demo-wellbeing' },
    ],
    19: [
      r,
      'career',
      'Gave a five-minute demo of the recipe app at a local meetup. Shaky start, good questions after.',
      { mood: 4, goalId: 'demo-presence' },
    ],
    15: [
      r,
      'general',
      'First guitar lesson at the community center. Three chords, sore fingers, already looking forward to the next one.',
      { mood: 4, goalId: 'demo-guitar' },
    ],
    11: [
      r,
      'general',
      'Day trip to the lake with friends. Phone mostly off.',
      { mood: 5, goalId: 'demo-enjoy' },
    ],
    4: [
      r,
      'general',
      'Co-op game night online with the old group.',
      { mood: 4, goalId: 'demo-enjoy' },
    ],
    2: [
      r,
      'health',
      'Release day at work ran late. Kept the career step, skipped the rest, in bed on time.',
      { energy: 2, goalId: 'demo-sleep' },
    ],
  };
  if (once[r.ago]) log(...once[r.ago]);
  if (weekday === 5 && r.ago % 14 < 7)
    log(r, 'social', 'Board-game night at a friend’s place.', { mood: 4, goalId: 'demo-friends' });
  if (weekday === 0 && r.ago % 14 >= 7)
    log(r, 'social', 'Stayed for lunch after pickleball with the Sunday group.', {
      mood: 4,
      goalId: 'demo-friends',
    });
}

/** How many days ago the trading practice was paused, after a rule-broken stretch. */
const TRADING_PAUSED_AGO = 6;

/** Turns the trading objective on or off as a person would in Programs, before the day opens. */
function setTrading(state: State, date: string, enabled: boolean): State {
  const program = state.programs.find((p) => p.routines.some((x) => x.id === DEMO.trading))!;
  const routine = program.routines.find((x) => x.id === DEMO.trading)!;
  return upsertRoutine(state, program, { ...routine, enabled }, at(date, 6, 30));
}

/**
 * The full demo for `today`: six weeks of fictional history, then today opened and left to do.
 * Deterministic for a given date.
 */
export function demoState(today: string): State {
  const start = shiftDate(today, -DEMO_DAYS);
  const studyFrom = shiftDate(today, -35);
  const tradingFrom = shiftDate(today, -30);
  const made = at(start, 9);
  let state: State = {
    ...emptyState(),
    source: 'demo',
    goals: DEMO_GOALS.map((g) => ({ ...g })),
    programs: demoPrograms(studyFrom),
    workoutTemplates: demoTemplates(made),
    intervalRoutines: [demoCircuit(made)],
    ruleBooks: [demoRuleBook(tradingFrom, made)],
    // Scheduling context only (wake, bedtime, office hours): never objectives.
    settings: {
      ...emptyState().settings,
      wake: 7 * 60 + 30,
      bedtime: 23 * 60 + 30,
      workStart: 9 * 60,
      workEnd: 17 * 60 + 30,
    },
  };
  const r: Replay = {
    state,
    ago: DEMO_DAYS,
    date: start,
    sessions: 0,
    restTaken: false,
    workoutSkipped: false,
    companionMoved: false,
    tradingDays: 0,
    sickDay: false,
    homeSkipped: false,
    accessoriesSkipped: false,
  };
  for (let ago = DEMO_DAYS; ago >= 1; ago--) {
    r.ago = ago;
    r.date = shiftDate(today, -ago);
    if (r.date === tradingFrom) r.state = setTrading(r.state, r.date, true);
    if (ago === TRADING_PAUSED_AGO) r.state = setTrading(r.state, r.date, false);
    r.state = ensureDay(r.state, r.date, at(r.date, 7));
    const weekday = dateObject(r.date).getDay();
    if (!r.sickDay && ago <= 9 && weekday >= 1 && weekday <= 5) {
      // A sick weekday, protected: nothing else is recorded and the streaks hold.
      r.sickDay = true;
      r.state = withDay(r.state, protectDay(r.state.days[r.date], 'illness', at(r.date, 9)));
      continue;
    }
    weight(r);
    plainDone(r);
    strength(r);
    companions(r);
    study(r);
    cardio(r);
    money(r);
    weekend(r);
    trading(r, tradingFrom);
    life(r);
  }
  state = ensureDay(withDemoDirection(r.state, today), today, at(today, 0, 1));
  // Pausing through the routine editor marks the data as the user's own; the demo stays a demo.
  return { ...state, source: 'demo' };
}

/** Nothing saved that the demo would replace: no programs, goals, days or records. */
export function isBlank(state: State): boolean {
  return (
    !state.programs.length &&
    !state.goals.length &&
    !Object.keys(state.days).length &&
    [
      state.measurements,
      state.lifeLog,
      state.workoutSessions,
      state.moneyReviews,
      state.intervalSessions,
      state.activitySessions,
      state.ruleReviews,
      state.focuses,
      state.weeklyReviews,
      state.skillCheckpoints,
    ].every((list) => !list.length)
  );
}
