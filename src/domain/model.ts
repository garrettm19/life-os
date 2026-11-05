import type { TradingSession } from './trading';

export type Goal = { id: string; title: string; desiredState: string };
export type Routine = {
  id: string;
  title: string;
  duration: number | null;
  weekdays: number[] | null;
  preferredStart: number | null;
  thursdayStart?: number | null;
  windowStart?: number | null;
  windowEnd?: number | null;
  enabled: boolean;
  fixed: boolean;
  steps: string[];
  bundledInto: string | null;
  /** Completion item. It is not placed on the clock and a missing time is not an error. */
  checklist?: boolean;
  /** Omit this routine’s title from the Home Screen widget, even if a time is later added. */
  private?: boolean;
  /**
   * The objective is completed by recording something: a body-weight measurement or a money
   * review. Workouts are linked from their template instead (`WorkoutTemplate.routineId`).
   */
  capture?: 'weight' | 'money' | 'activity' | 'rules';
  /** Activity choices offered when recording a duration activity (for example cardio types). */
  activities?: string[];
  /**
   * A companion: due on any day that holds an occurrence of one of these routines (for example a
   * home routine after certain gym days). Completing the parent never completes it.
   */
  follows?: string[];
  /**
   * Encouraged but never required: its occurrences are shown on Today and can be done, but they
   * never count toward Day Cleared (for example a daily weigh-in). Copied onto each occurrence when
   * it is created, so days already recorded keep the meaning they had.
   */
  optional?: boolean;
  /**
   * A daily alternation: on each calendar day the occurrence takes the next variant, counted from
   * `anchor` (variant 0 on that date). Missing a day never shifts it, and nothing is owed.
   */
  alternate?: { anchor: string; variants: { title: string; steps: string[] }[] };
  /** Web links shown with the objective's instructions (for example a study site). */
  links?: { label: string; url: string }[];
  /**
   * Every N weeks on its weekdays, counted from the week of `anchor` (an "on" week). Absent means
   * every week. Not for study objectives, bundled steps or rotation workouts (`src/domain/repeat.ts`).
   */
  repeat?: { everyWeeks: number; anchor: string };
  /**
   * A guided study session: timed stages run on Today's Study screen. Its presence makes this a
   * study objective, like a linked workout plan or circuit; a routine has at most one of them.
   */
  study?: StudyPlan;
  /**
   * The routine's place in the order of the day, a whole number from 0 to 10000: lower comes
   * earlier on Today and the Large widget. Absent places it after every routine with one, in
   * Programs order (`src/domain/day-order.ts`). Read at display time; never copied into a day.
   */
  dayOrder?: number;
  /**
   * The morning anchor: this checklist routine is the user's "Up by" time. Each entry holds
   * from its date, so a change of time never re-judges an earlier morning. At most one enabled
   * routine carries it. Read only by `src/domain/anchor.ts`.
   */
  anchor?: MorningAnchor;
};
/** The anchor time as it was set, in minutes after local midnight, from each date it took effect. */
export type MorningAnchor = { history: AnchorTime[] };
export type AnchorTime = { from: string; upBy: number };
export type StudyLink = { label: string; url: string };
/** One stage of a study session (for example 25 minutes of learning and implementation). */
export type StudyStage = { id: string; title: string; minutes: number; links: StudyLink[] };
export type StudyPlan = {
  stages: StudyStage[];
  /** Preferred local start time in minutes after midnight, or null when not chosen. */
  at: number | null;
  /** Local reminders. Nothing is scheduled without the user's notification permission. */
  reminders: {
    /** A reminder at the preferred time on due days. */
    start: boolean;
    /** A later reminder (minutes after midnight) if the objective is still open, or null. */
    evening: number | null;
    /** A notification when a running stage reaches its planned length. */
    stageEnd: boolean;
  };
  /**
   * The first local date the study streak scores, set when the objective becomes a study objective.
   * Earlier dates are never counted as kept or missed.
   */
  trackFrom?: string;
  /**
   * The schedule as it was set, from each date it took effect: the record of when study was due,
   * so a later change of days or a pause never re-reads earlier days. Appended on routine edits.
   */
  schedule?: StudySchedule[];
  /**
   * An optional starting cue in the user's words ("After dinner"): the situation in which study
   * begins. Shown on Today; never a reminder time.
   */
  cue?: string;
};
export type StudySchedule = { from: string; weekdays: number[]; enabled: boolean };
/**
 * A continuous workout rotation: the routines in `order` follow one another, one per training day.
 * The next workout is derived from the last one completed, so rest days, missed days and moves
 * never advance it. `restDays` are default rest weekdays; any day can be switched by the user.
 */
export type ProgramRotation = {
  order: string[];
  restDays: number[];
  startWith: string | null;
  /**
   * Each workout's own schedule from before it joined the rotation, so leaving the rotation (or
   * turning it off) gives it back exactly instead of leaving it with no days.
   */
  previous?: { routineId: string; weekdays: number[] | null; checklist: boolean }[];
};
export type Program = {
  id: string;
  title: string;
  group: string;
  goalIds: string[];
  routines: Routine[];
  rotation?: ProgramRotation;
};
/** A user's choice to rest on a training day, or to train on a default rest day. */
export type RotationOverride = { programId: string; mode: 'rest' | 'train'; at: string };
export type Settings = {
  wake: number;
  bedtime: number;
  workStart: number | null;
  workEnd: number | null;
  scrumStart: number | null;
  scrumDuration: number | null;
  thursdayMeetingStart: number | null;
  thursdayMeetingDuration: number | null;
  gymTravel: number | null;
  eveningWorkMinutes: number | null;
  /**
   * Opt-in: show today's Day Cleared status on the Home Screen widget. It is derived from every
   * objective, private ones included, so it is off unless the user turns it on. A device preference:
   * setup imports never change it.
   */
  widgetDayStatus?: boolean;
  /** How the interval timer announces transitions. Remembered between sessions; voice by default. */
  timerCue?: CueMode;
  /**
   * When a backup export was last confirmed on this device (in the browser, when the download
   * started); after a restore, the backup's own time.
   */
  lastBackupAt?: string;
};
export type CueMode = 'voice' | 'beep' | 'mute';
export type BundledStep = {
  id: string;
  routineId: string;
  programId: string;
  title: string;
  steps: string[];
  status: 'planned' | 'done' | 'skipped';
  actualAt: string | null;
  /** Optional like its routine (or its parent): shown, never counted toward Day Cleared. */
  optional?: boolean;
};
export type Block = {
  id: string;
  routineId: string | null;
  programId: string | null;
  title: string;
  start: number | null;
  duration: number | null;
  fixed: boolean;
  status: 'planned' | 'done' | 'skipped';
  actualAt: string | null;
  steps: string[];
  bundledSteps?: BundledStep[];
  reason: string | null;
  windowStart?: number | null;
  windowEnd?: number | null;
  checklist?: boolean;
  private?: boolean;
  /**
   * The local date this occurrence was originally scheduled on, when a sequence shift moved it to
   * another day. The block keeps its original ID, so its history stays one workout.
   */
  movedFrom?: string;
  /** An optional objective: shown and recordable, never counted toward Day Cleared. */
  optional?: boolean;
  /**
   * On a done morning anchor: the time the user says they were up, in minutes after local midnight
   * of this day, entered the same day for a tick that came late. Judged in place of the tick time
   * and shown as corrected. Cleared by any change of status.
   */
  upAt?: number;
};
/**
 * Recorded on the original day of a moved occurrence so generation never recreates it there. `to`
 * is where it went at that time; once the original day has passed it is not updated again.
 */
export type MovedOut = { routineId: string; to: string; at: string };
export type ProtectionReason = 'illness' | 'travel' | 'recovery' | 'technical' | 'other';
export type DayProtection = { reason: ProtectionReason; at: string };
export type Day = {
  date: string;
  blocks: Block[];
  commitmentsKey?: string;
  revisions: { at: string; reason: string; blocks: Block[] }[];
  /** Preserves the Day Clear streak without fabricating completions. */
  protection?: DayProtection;
  /** Sorted IDs of timed routines due on this date, recorded while the date was today or later. */
  dueTimed?: string[];
  /** Occurrences moved off this date by a sequence shift; they are no longer due here. */
  moved?: MovedOut[];
  /** Rest or train choices for rotation programs on this date. */
  rotation?: RotationOverride[];
};
export type WeightUnit = 'lb' | 'kg';
/**
 * A dated observation. Weight is the first kind; the schedule (weekly today) lives in the routine,
 * so a measurement means the same thing whatever the recording frequency.
 */
export type Measurement = {
  id: string;
  kind: 'body-weight';
  /** Canonical value in whole grams. */
  grams: number;
  /** Exactly what was typed, so the record reads back as entered. */
  entered: { value: number; unit: WeightUnit };
  /** Local date the measurement describes. */
  date: string;
  /** When it was recorded (ISO). */
  at: string;
  fasted: boolean | null;
  note: string;
  /** The objective occurrence that prompted it, if any. */
  occurrenceId: string | null;
};
export const LOG_CATEGORIES = [
  'general',
  'health',
  'training',
  'career',
  'money',
  'social',
  'learning',
  'reflection',
] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];
/** A short, private, dated note about what happened. Optional ratings are self-reports. */
export type LifeLogEntry = {
  id: string;
  date: string;
  at: string;
  text: string;
  category: LogCategory | null;
  /** 1–5 self-reported energy, or null when not given. */
  energy: number | null;
  /** 1–5 self-reported mood, or null when not given. */
  mood: number | null;
  goalId: string | null;
};
export type PlannedExercise = {
  id: string;
  name: string;
  sets: number;
  repsMin: number;
  /** Upper end of a rep range; null for a single target. */
  repsMax: number | null;
  /** Optional target load in `unit`. */
  load: number | null;
  unit: WeightUnit;
  restSeconds: number | null;
  note: string;
  /**
   * `time` for an exercise recorded as a duration (for example a sled push): each set records
   * seconds instead of load and reps, and `seconds` is the target per set. Absent means reps.
   * The same `id` in two plans means the same exercise, sharing history and graphs.
   */
  kind?: 'time';
  seconds?: number | null;
};
/** The reusable plan for a workout routine. Editing it never changes recorded sessions. */
export type WorkoutTemplate = {
  id: string;
  routineId: string;
  title: string;
  note: string;
  exercises: PlannedExercise[];
  updatedAt: string;
};
export type LoggedSet = {
  reps: number | null;
  load: number | null;
  done: boolean;
  /** Seconds performed, for a timed exercise. */
  seconds?: number | null;
};
export type SessionExercise = {
  exerciseId: string;
  /** Snapshot of the plan when the session started. */
  name: string;
  unit: WeightUnit;
  plan: {
    sets: number;
    repsMin: number;
    repsMax: number | null;
    load: number | null;
    seconds?: number | null;
  };
  sets: LoggedSet[];
  kind?: 'time';
  /** The planned exercise this one replaced for this session only (a same-day substitution). */
  substitutedFor?: { exerciseId: string; name: string };
};
/** What was actually performed for one workout occurrence. */
export type WorkoutSession = {
  /** `session:` + occurrence ID: one session per occurrence, resumed if reopened. */
  id: string;
  templateId: string;
  routineId: string;
  occurrenceId: string;
  /** Date the occurrence was originally scheduled on. */
  scheduledDate: string;
  /** Date the occurrence sits on when it is performed (after any shift). */
  date: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'active' | 'completed';
  exercises: SessionExercise[];
  note: string;
};
/**
 * A manual weekly money snapshot. Amounts are integer minor units (cents) in `currency`; null means
 * not reported, which is different from zero.
 */
export type MoneyReview = {
  id: string;
  date: string;
  at: string;
  currency: string;
  cash: number | null;
  savings: number | null;
  debt: number | null;
  upcoming: number | null;
  contributed: number | null;
  /** Savings target in effect for this review, when the user set one. */
  savingsTarget: number | null;
  /** The one optional priority for the coming week, in the user's words. */
  nextAction: string;
  /** When the user marked that priority done; absent or null while it is open. */
  priorityDoneAt?: string | null;
  note: string;
  goalId: string | null;
  occurrenceId: string | null;
};
/** One work interval of a timed circuit, followed by `restAfter` seconds of rest (zero allowed). */
export type IntervalStep = { id: string; name: string; seconds: number; restAfter: number };
export type IntervalPlan = { prepSeconds: number; steps: IntervalStep[] };
/**
 * A timed circuit linked to one routine: the editable plan, plus the plan it started from so the
 * user can restore it. Editing it never changes recorded sessions.
 */
export type IntervalRoutine = IntervalPlan & {
  id: string;
  routineId: string;
  title: string;
  original: IntervalPlan;
  updatedAt: string;
};
/**
 * One circuit run to its end. An interrupted circuit is never saved as a session. `skipped` names
 * work intervals the user skipped on the way, so a fast-forwarded run never reads as a full one.
 */
export type IntervalSession = {
  /** `interval:` + occurrence ID when it completes an objective: one per occurrence. */
  id: string;
  intervalId: string;
  routineId: string;
  occurrenceId: string | null;
  date: string;
  startedAt: string;
  finishedAt: string;
  plannedSeconds: number;
  skipped: string[];
};
/** A duration activity actually done (for example cardio): what, and for how long. */
export type ActivitySession = {
  id: string;
  date: string;
  at: string;
  routineId: string | null;
  occurrenceId: string | null;
  activity: string;
  minutes: number;
  note: string;
  /**
   * Present for a timed study session: what each stage actually ran. `minutes` is the whole minutes
   * of their total, so weekly minutes stay one sum; cardio leaves these sessions out.
   */
  study?: StudyRecord;
};
export type StudyStageRecord = {
  id: string;
  title: string;
  plannedSeconds: number;
  /** Seconds the stage clock actually ran, never more than planned. */
  seconds: number;
  /** The user moved past this stage (or confirmed the last one). */
  done: boolean;
};
export type StudyRecord = { startedAt: string; stages: StudyStageRecord[] };
/**
 * A personal rulebook for a rule-adherence review: short checkpoints answered after each session,
 * and the full rules for reference (any of which can be recorded as broken).
 */
export type RuleBook = {
  id: string;
  routineId: string;
  title: string;
  checkpoints: { id: string; text: string }[];
  rules: { id: string; title: string; details: string }[];
  updatedAt: string;
  /** Present on the trading rulebook: the Trading discipline process (see `domain/trading.ts`). */
  trading?: TradingProfile;
};
/** One short rule with optional detail shown on request. */
export type TradingItem = { id: string; title: string; details: string };
/**
 * The trading discipline process kept with its rulebook: the four-step decision framework, the
 * eight-item daily process checklist (PASS or FAIL), the hard violations that can be recorded,
 * the post-loss reset and the user's own limits as written. Everything here is the user's own
 * rules, self-reported against; nothing is checked against a broker.
 */
export type TradingProfile = {
  /** The local date the process started: nothing before it is scored. */
  since: string;
  framework: TradingItem[];
  checklist: TradingItem[];
  violations: TradingItem[];
  /** The user's limits as written, units included ("$40 per account"). Display only. */
  limits: { id: string; label: string; value: string }[];
  /** Failed theses that end the day; null when not set. */
  maxFailedTheses: number | null;
  /**
   * The session's entry cap, 1 to 10: one execution (however many accounts it was copied to) is
   * one entry, a partial exit never is, and a trade logged after the fact counts. Reaching it ends
   * the session until the next 9:30 AM window. Absent counts as 3.
   */
  maxEntries?: number;
  /**
   * Losses in a row that end the session, 1 to 5 (`lossInRun`: stopped out or structurally
   * invalidated, or ended with a reported, estimated or unknown loss above zero; the objective or
   * an exit with no loss breaks the run). Absent counts as 2.
   */
  maxLossRun?: number;
  /**
   * The most the session may lose across every copied account together, in dollars; the session
   * counts against the stricter of this and the daily loss limit times the accounts. Absent: no
   * total beyond that product.
   */
  dailyLossTotal?: number;
  /**
   * A raise saved on `candle`: the limits that stood on it before (`RiskSettings`). Until the next
   * candle the stricter of these and the saved ones holds, so a raise waits for the next candle's
   * session while a cut applies at once. Absent when no raise is waiting.
   */
  raisedOn?: { candle: string; before: RiskSettings };
  /**
   * The local date the money question was last answered Yes (the money for these accounts is set
   * aside, not credit or money needed for bills or debt), when live trading was turned on. Only
   * the date is kept; it is asked again each time.
   */
  moneySetAsideOn?: string;
  /**
   * The local date live trading was last turned on for one live account the trader already
   * trades, confirmed in Your limits in place of the clean practice sessions (with the money
   * question too). Only the date is kept; it is confirmed again each time live trading is turned
   * on that way, and it never allows more than one account.
   */
  existingAccountOn?: string;
  /**
   * The New York time ("HH:MM", before 18:00) by which the trader must be flat on each candle,
   * as the firm's rules say. In a live session the status warns 15 minutes before it, asks an
   * open trade for its outcome after it and holds new entries until the candle ends. Absent: none.
   */
  flatBy?: string;
  reset: { minutes: number; steps: string[] };
  /**
   * The last time the account set was reported lost: live trading is paused until `until` (a
   * local date 30 days after `at`). Absent until reported once.
   */
  fundedSetLost?: { at: string; until: string };
  /**
   * The one instrument traded, as the user entered it: its name, the dollar value of one point for
   * one contract and the price tick. Absent until set; never a code default.
   */
  instrument?: TradingInstrument;
  /**
   * The numeric risk limits, per account: contracts, dollar risk per thesis and the daily loss
   * limit. Each is null until set, and an unset limit blocks the risk check instead of being
   * assumed. Absent on profiles saved before them.
   */
  risk?: TradingRisk;
  /**
   * The accounts every execution is copied to, 1 to 20: one intentional execution is one attempt,
   * its risk counted on every account. Absent counts as 1.
   */
  accounts?: number;
  /**
   * Estimated costs per contract for a round trip: commission in dollars and slippage in ticks.
   * Null where not set: risk is then shown without costs, and said so.
   */
  costs?: { commission: number | null; slippageTicks: number | null };
  /** Qualified attempts on one thesis, 1 or 2. Absent counts as 2. */
  attemptsPerThesis?: number;
  /** Minutes of the I FEEL RUSHED cooldown, 20 to 60. Absent counts as 25. */
  cooldownMinutes?: number;
  /**
   * Live trading, turned on only deliberately outside a session. Absent or false: every session is
   * practice (simulation or replay), whatever else allows it.
   */
  liveTrading?: boolean;
  /**
   * My Trading Strategy: the reference cards, My Key and Setup B's retake rule. Absent until first
   * edited; the generic reference applies until then. Enforcement reads only the retake rule.
   */
  strategy?: TradingStrategy;
};
/** One card of the strategy reference: a title, a short summary and the full definition. */
export type StrategyStep = { title: string; summary: string; detail: string };
/**
 * The strategy reference kept on the profile: the steps as written, My Key (the user's own notes,
 * empty until written) and Setup B's retake rule (null until written; B cannot complete until
 * then).
 */
export type TradingStrategy = { steps: StrategyStep[]; key: string; retakeRule: string | null };
export type TradingInstrument = { name: string; pointValue: number; tick: number };
/**
 * Every setting a raise waits on, as it stands: the dollar limits per account (null until set),
 * the total across accounts (null for none), the contract limit, the accounts, the session's entry
 * cap and loss run, and the cooldown (a shorter one is a raise).
 */
export type RiskSettings = {
  tradeRisk: number | null;
  thesisRisk: number | null;
  dailyLoss: number | null;
  dailyLossTotal: number | null;
  maxContracts: number | null;
  accounts: number;
  maxEntries: number;
  maxLossRun: number;
  cooldownMinutes: number;
  /** The flat-by time (`TradingProfile.flatBy`), present only when set: none is the loosest. */
  flatBy?: string;
};
export type TradingRisk = {
  /**
   * The fixed dollars risked per trade on each account: the structural stop sets the contracts.
   * Null or absent until set.
   */
  tradeRisk?: number | null;
  maxContracts: number | null;
  thesisRisk: number | null;
  dailyLoss: number | null;
};
/**
 * The local date live trading resumes after a lost account set, while `today` is before it;
 * otherwise null. Until then no session starts and the trading objective is not resumed.
 */
export function accountSetPause(profile: TradingProfile | undefined, today: string): string | null {
  const until = profile?.fundedSetLost?.until;
  return until && today < until ? until : null;
}
/** The kind of GEX level an area is mapped from. */
export type GexKind = 'call-wall' | 'put-wall' | 'gamma-flip' | 'vol-trigger' | 'focus' | 'other';
/**
 * One GEX area as the user mapped it: the level's kind and price, an optional zone in points either
 * side, and the session lock it was mapped under (the candle's 6 PM or 9:30 AM lock) with when.
 */
export type GexArea = {
  kind: GexKind;
  price: number;
  zone: number | null;
  lock: 'evening' | 'morning';
  candle: string;
  at: string;
};
/** The named setups an entry can be taken on. */
export type SetupId = 'pierce-push' | 'sweep-retake' | 'double-pierce';
/** The chart the named setup was read on. */
export type Timeframe = '5m' | '15m';
/**
 * How an entry taken on the cockpit ended, as reported: the normal target reached, stopped out or
 * flat by hand; or, for a runner left open at the normal target, the runner at the expansion
 * target, at its stop, or exited on structure.
 */
export type ExitKind =
  'objective' | 'stopped' | 'flat' | 'expansion' | 'runner-stopped' | 'runner-structure';
/** What kind of daily (or 4-day) candle the session is inside, as the user classified it. */
export type RegimeKind = 'range' | 'candidate' | 'confirmed';
/** The completed candle that informs the classification. */
export type RegimeContext = 'daily' | 'four-day';
/** The three things seen before an expansion is called confirmed, all self-reported. */
export type RegimeEvidence = { displacement: true; structure: true; room: true };
/**
 * One classification of the HTF candle: its kind, the candle that informs it, the evidence (only,
 * and always, on a confirmed expansion) and when it was made. Never read from a market.
 */
export type Regime = {
  kind: RegimeKind;
  context: RegimeContext;
  evidence?: RegimeEvidence;
  at: string;
};
/**
 * The session thesis card, committed before Start session and locked for that daily candle. Every
 * field is one trimmed line of 1 to 160 characters; `addPlan` is null when no add is planned. A
 * card committed on the cockpit also keeps the numeric objective and invalidation and the GEX area
 * (its text fields are written from them, so a card always reads the same everywhere).
 */
export type ThesisCard = {
  /** The side the daily bias allowed at Start session. Absent on cards committed before it. */
  direction?: 'long' | 'short';
  expectation: string;
  gexReason: string;
  objective: string;
  zone: string;
  invalidation: string;
  addPlan: string | null;
  committedAt: string;
  /** The normal objective and the invalidation as prices, together or not at all. */
  objectivePrice?: number;
  invalidationPrice?: number;
  /** The larger expansion objective beyond the normal one, when planned. */
  expansionPrice?: number;
  gex?: GexArea;
  /** The HTF candle's classification at the lock. Absent on cards committed before it. */
  regime?: Regime;
};
/** The lower-timeframe permission chosen on the bias board's setup check. */
export type EntryPermission =
  | 'sweep-reclaim'
  | 'displacement'
  | 'cisd'
  | 'rejection'
  | 'structure-shift'
  | 'break-retest'
  | 'other';
/** A rule an entry was taken outside of, as it stood when the entry was logged. */
export type OutsideRule =
  /** Not every setup condition was confirmed. */
  | 'conditions'
  /** Trading was already done for the day (a hard stop, an invalidated thesis, a limit). */
  | 'done'
  /** During the reset after a failed thesis. */
  | 'reset'
  /** After a reset that found nothing genuinely new. */
  | 'nothing-new'
  /** Outside the session's live windows (the 9:30 AM window, before October 24, 2026). */
  | 'window'
  /** With no entries left under the day's limit. */
  | 'limit';
/**
 * One self-reported entry: which conditions were confirmed when it was logged, never a fill, a
 * result, a P&L or a screenshot. The first is an `entry`, every later one an `add` (an add or a
 * re-entry), and an add without a planned add location is `unplanned`. `side` is the side the
 * daily bias allowed. An entry that followed the rules has every condition confirmed; one logged
 * with "Log an entry I took" keeps the conditions as they were and lists in `outsideRules` the
 * rules it was taken outside of (`withBias` is false when the side was not confirmed). An entry
 * taken on the cockpit also keeps the named setup, its chart, "not chasing", the planned entry,
 * stop and contracts per account, and later how it ended (`exit`), all as reported.
 */
export type EntrySnapshot = {
  at: string;
  kind: 'entry' | 'add';
  side: 'long' | 'short';
  permission: EntryPermission | null;
  zone: boolean;
  gexSupports: boolean;
  invalidation: boolean;
  withBias?: false;
  unplanned?: true;
  outsideRules?: OutsideRule[];
  setup?: SetupId;
  timeframe?: Timeframe;
  notChasing?: true;
  plan?: EntryPlan;
  /** A planned runner's normal target reached: the rest closed, the runner still open. */
  partial?: { at: string };
  exit?: { kind: ExitKind; at: string };
};
/** How a runner's stop is managed once the normal target is reached: never farther away. */
export type RunnerStopPlan = 'breakeven' | 'original';
/**
 * The prices and size planned for one entry, per account: the entry, the protective stop, the
 * contracts, the normal target (the card's objective) and the expansion target when the card has
 * one. A runner keeps `runner.contracts` (1 to contracts − 1) open past the normal target toward
 * the expansion target; the total contracts and the risk stay as planned.
 */
export type EntryPlan = {
  entry: number;
  stop: number;
  contracts: number;
  normalTarget: number;
  expansionTarget?: number;
  runner?: { contracts: number; stopPlan: RunnerStopPlan };
};
/** The review's six discipline questions, by key. */
export type DisciplineKey =
  'labeled' | 'distinguished' | 'withBias' | 'namedSetups' | 'noPrediction' | 'followedPlan';
/** The review's discipline answers: true for Yes, false for No. */
export type Discipline = Record<DisciplineKey, boolean>;
export type RuleAnswer = 'yes' | 'no' | 'na';
/**
 * One review: either the checkpoints answered after an activity, or a day without the activity.
 * A day without it is its own outcome, never a perfect score.
 */
export type RuleReview = {
  id: string;
  date: string;
  at: string;
  routineId: string;
  occurrenceId: string | null;
  outcome: 'reviewed' | 'none';
  answers: { checkpointId: string; answer: RuleAnswer }[];
  /** Rules from the full rulebook recorded as broken (hard violations on a trading review). */
  violations: string[];
  note: string;
  /**
   * Present on a Trading discipline review: answers are the eight checklist items (yes = PASS,
   * no = FAIL), violations are hard violations, and `note` is the one thing to improve.
   */
  trading?: {
    /** A session with trades, a deliberate session without one, or a planned day away. */
    session: 'traded' | 'no-trade' | 'away';
    /** Self-reported, optional. One idea mirrored on several accounts is one entry. */
    entries: number | null;
    failedTheses: number | null;
    /** A traded session's thesis card as committed, copied from the device. Absent before it. */
    thesis?: ThesisCard;
    /** A traded session's logged entries, copied from the device. Absent before the counter. */
    entryLog?: EntrySnapshot[];
    /**
     * The six discipline answers of a session (traded or not). Absent on a day away and on
     * reviews saved before them, which keep the result they were recorded with.
     */
    discipline?: Discipline;
    /**
     * Saved on its candle's date, by this build: read as the date's own candle. A review without
     * it was saved by an earlier build, by the record its session was kept on (`candleReview`).
     */
    ownCandle?: true;
  };
  /** When a saved trading review was last corrected; absent on a review never corrected. */
  editedAt?: string;
};
/** What kind of recorded evidence a focus reads on Progress; null reads none. */
export type FocusEvidence = 'career' | 'money' | 'training' | 'trading';
/**
 * The one priority the user chose for a period (usually 90 days). It links to existing goals and
 * routines and creates nothing: its evidence is read from records that already exist. At most one is
 * active; a completed or archived focus stays readable with its reviews.
 */
export type Focus = {
  id: string;
  title: string;
  goalId: string | null;
  /** What meaningful progress looks like, in the user's words. */
  outcome: string;
  evidence: FocusEvidence | null;
  /** Existing routines that serve the focus, in the user's order. */
  routineIds: string[];
  /** The routine Today offers first, among `routineIds`; null means the first one due. */
  leadRoutineId: string | null;
  /** An optional if–then starting cue in the user's words. Text only: never a reminder time. */
  cue: string;
  /** Optional notes: where things stand at the start, and a target or milestone. */
  baseline: string;
  target: string;
  startDate: string;
  /** When the user means to review it; passing it changes nothing on its own. */
  reviewDate: string;
  status: 'active' | 'completed' | 'archived';
  /** When it was completed or archived; null while active. */
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
/**
 * The optional weekly course correction: one per week (Monday to Sunday), linked to the focus that
 * was active when it was first saved. Edits keep that link and the first save time.
 */
export type WeeklyReview = {
  id: string;
  /** The Monday of the week reviewed (local date). */
  weekStart: string;
  focusId: string | null;
  obstacle: string;
  /** The one change chosen for next week; empty when none was chosen. */
  adjustment: string;
  /** "No adjustment needed" chosen explicitly. */
  noChange: boolean;
  at: string;
  updatedAt: string;
};
export type CheckpointDifficulty = 'easy' | 'medium' | 'hard' | 'mixed';
/**
 * A skill checkpoint done outside the app (for example a set of interview-style problems under a
 * time limit), recorded as it happened. Results compare only under the same conditions on new
 * problems; nothing here is a calibrated skill score.
 */
export type SkillCheckpoint = {
  id: string;
  date: string;
  at: string;
  /** Where and how: "Course site, unseen problems". */
  method: string;
  difficulty: CheckpointDifficulty;
  attempted: number;
  /** Solved without hints or looking up the solution. */
  solved: number;
  /** The time limit for the set, or null when untimed. */
  minutes: number | null;
  /** All problems were new to the user (not seen or practiced before). */
  fresh: boolean;
  topics: string;
  /** Optional next practice area. */
  next: string;
};
export type State = {
  version: 5;
  source: 'empty' | 'demo' | 'personal';
  goals: Goal[];
  programs: Program[];
  settings: Settings;
  days: Record<string, Day>;
  notes: string[];
  measurements: Measurement[];
  lifeLog: LifeLogEntry[];
  workoutTemplates: WorkoutTemplate[];
  workoutSessions: WorkoutSession[];
  moneyReviews: MoneyReview[];
  intervalRoutines: IntervalRoutine[];
  intervalSessions: IntervalSession[];
  activitySessions: ActivitySession[];
  ruleBooks: RuleBook[];
  ruleReviews: RuleReview[];
  focuses: Focus[];
  weeklyReviews: WeeklyReview[];
  skillCheckpoints: SkillCheckpoint[];
  /**
   * Each daily candle's trading session by its candle date (the trading date whose candle opens at
   * 6 PM New York the evening before): the plan, the lock, the entries and how trading ended. One
   * record per candle, whichever window it runs in.
   */
  tradingSessions: Record<string, TradingSession>;
  /**
   * Trading sessions kept on this device by earlier builds that could not be read or placed on a
   * candle when they were moved into the saved data, kept verbatim by the date they were stored
   * under. Never deleted; absent when there were none.
   */
  tradingSessionsUnreadable?: Record<string, string>;
  /**
   * The trading sessions earlier builds kept on this device have been moved into `tradingSessions`
   * (or there were none to move), so the move runs once. Absent only on data saved by those builds.
   */
  tradingSessionsImported?: true;
};
export const defaultSettings: Settings = {
  wake: 9 * 60,
  bedtime: 23 * 60,
  workStart: null,
  workEnd: null,
  scrumStart: null,
  scrumDuration: null,
  thursdayMeetingStart: null,
  thursdayMeetingDuration: null,
  gymTravel: null,
  eveningWorkMinutes: null,
};
export function emptyState(): State {
  return {
    version: 5,
    source: 'empty',
    goals: [],
    programs: [],
    settings: { ...defaultSettings },
    days: {},
    notes: [],
    measurements: [],
    lifeLog: [],
    workoutTemplates: [],
    workoutSessions: [],
    moneyReviews: [],
    intervalRoutines: [],
    intervalSessions: [],
    activitySessions: [],
    ruleBooks: [],
    ruleReviews: [],
    focuses: [],
    weeklyReviews: [],
    skillCheckpoints: [],
    tradingSessions: {},
    tradingSessionsImported: true,
  };
}
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function dateObject(key: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Use a valid calendar date.');
  const [y, m, d] = key.split('-').map(Number);
  const result = new Date(y, m - 1, d, 12);
  if (localDate(result) !== key) throw new Error('Use a valid calendar date.');
  return result;
}
export function shiftDate(key: string, days: number): string {
  const d = dateObject(key);
  d.setDate(d.getDate() + days);
  return localDate(d);
}
/** Whole days from `a` to `b` (negative when `b` is earlier); local dates, safe across DST. */
export function daysBetween(a: string, b: string): number {
  return Math.round((dateObject(b).getTime() - dateObject(a).getTime()) / 86_400_000);
}
/** The Monday of the week holding a date (local calendar, safe across daylight saving). */
export function weekStartOf(key: string): string {
  return shiftDate(key, -((dateObject(key).getDay() + 6) % 7));
}
/**
 * How many days a calendar of `weeks` whole Monday-to-Sunday weeks covers up to `key`: from the
 * Monday `weeks - 1` weeks before this week's, through `key` (22 on a Monday, 28 on a Sunday).
 */
export function calendarDays(key: string, weeks = 4): number {
  return daysBetween(shiftDate(weekStartOf(key), -7 * (weeks - 1)), key) + 1;
}
export function parseTime(value: string, allowMidnight = false): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error('Use 24-hour time, for example 14:30.');
  const h = Number(match[1]),
    m = Number(match[2]);
  if (h === 24 && m === 0 && allowMidnight) return 1440;
  if (h > 23 || m > 59) throw new Error('That time is outside the day.');
  return h * 60 + m;
}
export function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
export function displayTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  return `${h % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
export function displayDate(key: string): string {
  const d = dateObject(key);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
/** "Nov 9": the date without its weekday. */
export function shortDate(key: string): string {
  const d = dateObject(key);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
export function weekdayShort(key: string): string {
  return WEEKDAYS[dateObject(key).getDay()];
}
export function validateSettings(s: Settings) {
  if (
    !Number.isInteger(s.wake) ||
    !Number.isInteger(s.bedtime) ||
    s.wake < 0 ||
    s.bedtime > 1440 ||
    s.wake >= s.bedtime
  )
    throw new Error(
      'Bedtime must follow the start of the day, within this day (24:00 means midnight).',
    );
  for (const k of ['workStart', 'workEnd', 'scrumStart', 'thursdayMeetingStart'] as const) {
    if (s[k] !== null && (!Number.isInteger(s[k]) || s[k]! < 0 || s[k]! >= 1440))
      throw new Error('Check the meeting and work times.');
  }
  if (
    (s.workStart === null) !== (s.workEnd === null) ||
    (s.workStart !== null && s.workStart >= s.workEnd!)
  )
    throw new Error('Enter both work times, with the end after the start.');
  for (const k of [
    'scrumDuration',
    'thursdayMeetingDuration',
    'gymTravel',
    'eveningWorkMinutes',
  ] as const) {
    if (
      s[k] !== null &&
      (!Number.isInteger(s[k]) || s[k]! < (k === 'gymTravel' ? 0 : 1) || s[k]! > 720)
    )
      throw new Error('Durations must be whole minutes between 1 and 720 (travel can be zero).');
  }
  for (const [start, duration] of [
    [s.scrumStart, s.scrumDuration],
    [s.thursdayMeetingStart, s.thursdayMeetingDuration],
  ]) {
    if (start !== null && duration !== null && start + duration > s.bedtime)
      throw new Error('A meeting ends after bedtime.');
  }
}
export function validateWindow(r: { windowStart?: number | null; windowEnd?: number | null }) {
  const start = r.windowStart ?? null,
    end = r.windowEnd ?? null;
  if (start !== null && (!Number.isInteger(start) || start < 0 || start >= 1440))
    throw new Error('Check the earliest routine time.');
  if (end !== null && (!Number.isInteger(end) || end < 1 || end > 1440))
    throw new Error('Check the latest routine finish.');
  if (start !== null && end !== null && start >= end)
    throw new Error('The routine window must finish after it starts.');
}
export function validateRoutine(r: Routine) {
  validateWindow(r);
  if (!r.title.trim() || r.title.length > 200) throw new Error('Give the routine a short name.');
  if (r.duration !== null && (!Number.isInteger(r.duration) || r.duration < 1 || r.duration > 720))
    throw new Error('Duration must be 1–720 whole minutes.');
  if (r.weekdays !== null && r.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
    throw new Error('Choose valid weekdays.');
  for (const v of [r.preferredStart, r.thursdayStart ?? null])
    if (v !== null && (!Number.isInteger(v) || v < 0 || v >= 1440))
      throw new Error('Check the routine start time.');
}
