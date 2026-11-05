import { GexLockId } from './market-clock';
import { SetupId, Timeframe } from './model';
import {
  MAX_ACCOUNTS,
  MAX_CONTRACTS,
  MAX_ENTRIES,
  MAX_LOSS_RUN,
  PRICE_MAX,
  SETUP_IDS,
  isTimestamp,
  thesisLine,
} from './records';

// The live cockpit's records on a candle's trading session, kept beside the fields earlier builds
// saved (the bias, the card, the entries, the end of trading), which stay readable for history.
// One session per candle holds the plan, the lock with the limits it locked, the observed regime,
// the theses with their attempts, the setup assessments, the cooldowns, the session stop, the
// line marks and a short log of what changed. Each list is appended to and never rewritten: a
// status is always derived from what is stored, so leaving the app, relaunching it or restoring
// the same backup can only recompute it. Everything is the user's own report; nothing here reads
// a market, a broker or an account.

/** Where price is against the area being traded, as the user reports it. */
export type ZoneState = 'away' | 'at' | 'left';
/**
 * How a CISD in the setup was confirmed. A single wick or tap is never enough: price ranging
 * around it, a candle body established in it or a double tap is.
 */
export type CisdHow = 'range' | 'body' | 'double-tap' | 'single-wick';
/** The market regime as observed live, one optional chip. Only a range blocks entries. */
export type ObservedKind = 'range' | 'directional' | 'candidate' | 'confirmed';
export type ObservedRegime = { kind: ObservedKind; at: string };

/** A major event on the candle's New York date at a New York time ("14:00"). */
export type PlanEvent = { name: string; time: string };

/**
 * The preparation for one candle: why (one line), the primary target and an optional secondary
 * one, the structural invalidation and where (a short label for the area traded; empty means "My
 * area"). A conditional plan expects a move into that area first, then looks for the bias's
 * side; an all-day plan looks for it all day. The bias itself stays the session's `bias`. `lock`
 * is the GEX lock the plan was made under (null before the candle's first lock opened); a later
 * lock needs one Confirm (`confirmed`) before new entries. `carriedFrom` names the candle a carried
 * plan came from.
 */
export type TradingPlan = {
  why: string;
  target: number;
  target2?: number;
  invalidation: number;
  where: string;
  conditional: boolean;
  event?: PlanEvent;
  at: string;
  lock: GexLockId | null;
  confirmed?: { lock: GexLockId; at: string }[];
  carriedFrom?: string;
};

/**
 * The limits and instrument fixed for the session when it starts (`lock.limits`). Dollar amounts
 * per account.
 */
export type LockedLimits = {
  tradeRisk: number;
  thesisRisk: number;
  dailyLoss: number;
  maxContracts: number;
  pointValue: number;
  tick: number;
  accounts: number;
  commission: number | null;
  slippageTicks: number | null;
  attemptsPerThesis: number;
  cooldownMinutes: number;
  resetMinutes: number;
};

/**
 * The session-wide caps locked beside them (`lockedCaps`): the entry cap, the losses in a row that
 * end the session and the total loss across accounts (null for none beyond the daily loss limit
 * times the accounts).
 */
export type SessionCaps = { maxEntries: number; maxLossRun: number; dailyLossTotal: number | null };

/** Everything a session counts against: the locked limits and the session caps. */
export type LiveLimits = LockedLimits & SessionCaps;

/**
 * The most the session may lose across every account, to the cent: the daily loss limit times the
 * accounts, or the total across accounts when that is stricter (`total`, so a screen can say which
 * one holds without comparing them again).
 */
export function dailyLossCap(limits: LiveLimits): { amount: number; total: boolean } {
  const each = Math.round(limits.dailyLoss * 100) * limits.accounts;
  const total = limits.dailyLossTotal === null ? each : Math.round(limits.dailyLossTotal * 100);
  return { amount: Math.min(each, total) / 100, total: total < each };
}

/** The most the session may lose across every account (`dailyLossCap`), in dollars. */
export function dailyLossTotalOf(limits: LiveLimits): number {
  return dailyLossCap(limits).amount;
}

/**
 * The session's start: when, whether it runs as practice or live (live only when everything
 * allows it at the start), and the limits locked then.
 */
export type LiveLock = { at: string; mode: 'practice' | 'live'; limits: LockedLimits };

/**
 * A thesis's states. `qualified` is never stored as a standing permission: it is derived from the
 * status each time, and logged only at the moment an attempt opens.
 */
export type ThesisStatus =
  | 'planned'
  | 'waiting'
  | 'qualified'
  | 'active'
  | 'reset'
  | 'second-eligible'
  | 'exhausted'
  | 'invalidated'
  | 'completed'
  | 'abandoned';

/** States a thesis never leaves. */
export const FINAL_STATUSES: ThesisStatus[] = [
  'exhausted',
  'invalidated',
  'completed',
  'abandoned',
];

/**
 * One trading idea: its direction, where (the area's label), target and structural invalidation.
 * The plan's thesis starts with the session; a new one later in the session says what changed,
 * and one against the bias keeps its written justification (`exception`).
 */
export type Thesis = {
  id: string;
  createdAt: string;
  origin: 'plan' | 'new';
  direction: 'long' | 'short';
  where: string;
  target: number;
  invalidation: number;
  changed?: string;
  exception?: string;
  statusLog: { status: ThesisStatus; at: string; reason?: string }[];
};

/** How an attempt ended, as reported. `reconciled`: closed in the broker earlier, not recorded. */
export type AttemptExitKind = 'objective' | 'stopped' | 'flat' | 'invalidated' | 'reconciled';
export type AttemptExit = {
  kind: AttemptExitKind;
  at: string;
  /** The result as reported; absent when not said. */
  result?: 'loss' | 'breakeven' | 'gain';
  /** The loss reported across every account, in dollars; absent when not reported. */
  loss?: number;
  /** After a failed attempt: whether the thesis is still valid, answered once. */
  stillValid?: boolean;
  answeredAt?: string;
};

/**
 * One execution: one attempt however many accounts it was copied to or however it was filled.
 * `contracts` are per account; `plannedRisk` is across every account, with the estimated costs
 * when they are set (`costsIncluded`), or null when no stop was given, or for a trade logged
 * outside the cockpit when there was no instrument to count it (unknown exposure either way). An
 * attempt logged outside the cockpit (`taken`) keeps the status that stood when it was logged and
 * the session stop holding then, has no setup reading, and counts on the thesis being worked, if
 * any: it uses one of that thesis's attempts and, failed, counts at its line.
 */
export type Attempt = {
  id: string;
  thesisId: string | null;
  assessmentId: string | null;
  openedAt: string;
  side: 'long' | 'short';
  entry: number;
  stop: number | null;
  contracts: number;
  accounts: number;
  plannedRisk: number | null;
  costsIncluded: boolean;
  practice: boolean;
  /**
   * Logged outside the cockpit: the status then, the one beneath an I FEEL RUSHED cooldown that
   * stood alone (`under`, what the review judges the trade by), and the session stop holding then.
   */
  taken?: { status: string; under?: string; stop?: StopReason };
  partials?: string[];
  exit?: AttemptExit;
};

/**
 * The setup as the user reads it, saved on every change: where price is, the named setup (with
 * the fast variant of the double pierce), the chart, how a CISD was confirmed (null when the setup
 * has none), whether the setup is confirmed, and the entry, structural stop and an optional lower
 * contract count. The latest for a thesis is its current reading.
 */
export type Assessment = {
  id: string;
  at: string;
  thesisId: string;
  zone: ZoneState | null;
  setup: SetupId | null;
  fast?: true;
  timeframe: Timeframe | null;
  cisd: CisdHow | null;
  confirmed: boolean;
  entry: number | null;
  stop: number | null;
  contracts: number | null;
};

/** A cooldown: I FEEL RUSHED, or after a failed attempt. It never ends early. */
export type Cooldown = { kind: 'rushed' | 'loss'; at: string; until: string };

/**
 * The session stopped: the daily loss reached, a hard stop, the HTF thesis invalidated, or simply
 * finished. Nothing new until `until`: the next candle's 9:30 AM window for a loss, a hard stop or
 * an invalidated thesis, the end of the candle when finished.
 */
export type SessionStop = {
  at: string;
  reason: 'daily-loss' | 'hard-stop' | 'invalidated' | 'finished';
  until: string;
};

/**
 * What ended a session with a hard stop, beside its reason (`stopCause`): the entry cap reached,
 * the losses in a row reached, or a trade logged while entries were held or above the risk per
 * trade. Stored apart from the stop, which stays a hard stop, so an earlier build reads it as one.
 */
export type StopCause = 'entry-cap' | 'loss-run' | 'logged-trade';

/** An I ENTERED tap refused: when, and the status that held then. */
export type RefusedEntry = { at: string; status: string };

/** Why trading is stopped: a session stop, or the end of trading an earlier build saved, or a review. */
export type StopReason = SessionStop['reason'] | 'no-trade' | 'reviewed';

/** A line (an area's label, normalized) marked baiting or invalidated for the rest of the session. */
export type LineMark = {
  label: string;
  kind: 'baiting' | 'invalidated';
  at: string;
  reason?: string;
};

/** One change recorded on the session, for the review. */
export type LiveEvent = { at: string; kind: LiveEventKind; detail?: string };
export type LiveEventKind =
  | 'plan'
  | 'confirm'
  | 'lock'
  | 'rushed'
  | 'regime'
  | 'thesis'
  | 'retire'
  | 'attempt'
  | 'partial'
  | 'exit'
  | 'reset'
  | 'loss'
  | 'line'
  | 'taken'
  | 'stop';

/** The live cockpit's fields on a session record. */
export type LiveFields = {
  plan?: TradingPlan;
  lock?: LiveLock;
  observed?: ObservedRegime[];
  theses?: Thesis[];
  attempts?: Attempt[];
  assessments?: Assessment[];
  cooldowns?: Cooldown[];
  sessionStop?: SessionStop;
  lines?: LineMark[];
  log?: LiveEvent[];
  /** The session caps locked with `lock`; absent on a session started before them. */
  lockedCaps?: SessionCaps;
  /** What ended the session, with a hard stop only. */
  stopCause?: StopCause;
  /** I ENTERED taps refused, oldest first; the oldest are dropped past the record limit. */
  refusals?: RefusedEntry[];
};

/** The default label of the area traded. */
export const MY_AREA = 'My area';
/** The longest area label. */
export const WHERE_MAX = 40;
/** The longest justification for a counter-bias exception. */
export const EXCEPTION_MAX = 300;
/** The most records of one kind kept for a session. */
export const MAX_LIVE_RECORDS = 2_000;

/** Invisible format characters (zero-width spaces and joiners, direction marks, tags). */
const FORMAT_CHARS =
  /[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]|\uDB40[\uDC01\uDC20-\uDC7F]/g;

/** The area's label as saved: invisible characters removed, trimmed, spaces collapsed. */
export function normalWhere(where: string): string {
  return where.replace(FORMAT_CHARS, '').trim().replace(/\s+/g, ' ');
}

/** The area's label as shown: `normalWhere`, "My area" when empty. */
export function whereText(where: string): string {
  return normalWhere(where) || MY_AREA;
}

/**
 * The area's label as compared: `whereText` with case ignored, "my area" when empty. Two theses
 * with the same line are at the same area whatever the setup, prices or chart, and a label that
 * only looks the same (an invisible character added) is the same line.
 */
export function lineKey(where: string): string {
  return whereText(where).toLowerCase();
}

/** A thesis's current status: the last one logged. */
export function thesisStatus(thesis: Thesis): ThesisStatus {
  return thesis.statusLog.at(-1)!.status;
}

/** Whether an attempt failed: stopped, invalidated, or closed flat or reconciled without a gain. */
export function failedAttempt(a: Attempt): boolean {
  if (!a.exit) return false;
  const { kind, result } = a.exit;
  if (kind === 'objective') return false;
  if (kind === 'flat' || kind === 'reconciled') return result !== 'gain';
  return true;
}

/**
 * What a closed attempt lost across every account: the loss reported; nothing for the objective
 * or a reported gain or breakeven; otherwise the planned risk (an estimate); unknown (null) when
 * none of those is known. An open attempt has lost nothing yet (its exposure is its planned risk).
 */
export function attemptLoss(a: Attempt): { amount: number | null; basis: 'reported' | 'planned' } {
  if (!a.exit) return { amount: 0, basis: 'reported' };
  if (a.exit.loss !== undefined) return { amount: a.exit.loss, basis: 'reported' };
  if (a.exit.kind === 'objective' || a.exit.result === 'gain' || a.exit.result === 'breakeven')
    return { amount: 0, basis: 'reported' };
  return { amount: a.plannedRisk, basis: 'planned' };
}

/**
 * A total of losses: the dollars known, whether any part is an estimate from planned risk, and
 * whether any part is unknown. Unknown is never counted as zero.
 */
export type LossTotal = { amount: number; planned: boolean; unknown: boolean };

/** The losses of some attempts added up to the cent (`attemptLoss`). */
export function lossOf(attempts: Attempt[]): LossTotal {
  let cents = 0;
  let planned = false;
  let unknown = false;
  for (const a of attempts) {
    const loss = attemptLoss(a);
    if (loss.amount === null) unknown = true;
    else cents += Math.round(loss.amount * 100);
    if (loss.basis === 'planned' && loss.amount !== null && loss.amount > 0) planned = true;
  }
  return { amount: cents / 100, planned, unknown };
}

/**
 * Whether a closed attempt extends the session's run of losses: stopped out or structurally
 * invalidated, or ended with a reported loss above zero; a flat or reconciled exit with no loss
 * reported counts its planned risk, and one whose loss is unknown counts as a loss (unknown is
 * never zero). The objective, or an exit with no loss, breaks the run.
 */
export function lossInRun(a: Attempt): boolean {
  if (!a.exit) return false;
  if (a.exit.loss !== undefined && a.exit.loss > 0) return true;
  if (a.exit.kind === 'stopped' || a.exit.kind === 'invalidated') return true;
  if (a.exit.kind === 'objective') return false;
  const loss = attemptLoss(a).amount;
  return loss === null || loss > 0;
}

/** The losses in a row the session's closed attempts end on (an open one is not counted yet). */
export function lossRunOf(attempts: Attempt[]): number {
  let run = 0;
  for (let i = attempts.length - 1; i >= 0; i--) {
    const a = attempts[i];
    if (!a.exit) continue;
    if (!lossInRun(a)) break;
    run++;
  }
  return run;
}

/**
 * The session cap the attempts reached, or null: the entry cap (one execution is one entry,
 * whatever the accounts or fills; a trade logged after the fact counts), then the losses in a
 * row. Either ends the session until the next 9:30 AM window.
 */
export function capReached(
  attempts: Attempt[],
  caps: Pick<SessionCaps, 'maxEntries' | 'maxLossRun'>,
): StopCause | null {
  if (attempts.length >= caps.maxEntries) return 'entry-cap';
  if (lossRunOf(attempts) >= caps.maxLossRun) return 'loss-run';
  return null;
}

/** An attempt still open with no known risk: exposure that is unknown, never zero. */
export function unknownExposure(attempts: Attempt[]): boolean {
  return attempts.some(
    (a) => (!a.exit && a.plannedRisk === null) || (a.exit && attemptLoss(a).amount === null),
  );
}

// Reading the live fields back. Every value is checked before a session is accepted; a session
// that fails is never taken for one without these fields.

type Raw = Record<string, unknown>;

function bad(): never {
  throw new Error('invalid');
}
function obj(v: unknown, keys: string[], required: string[]): Raw {
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad();
  const r = v as Raw;
  if (!Object.keys(r).every((k) => keys.includes(k))) bad();
  if (!required.every((k) => r[k] !== undefined)) bad();
  return r;
}
function ts(v: unknown): string {
  if (!isTimestamp(v)) bad();
  return v as string;
}
function price(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > PRICE_MAX) bad();
  return v as number;
}
function dollars(v: unknown, zero = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (!zero && v === 0) || v > PRICE_MAX)
    bad();
  return v as number;
}
function whole(v: unknown, min: number, max: number): number {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) bad();
  return v as number;
}
function oneOf<T extends string>(v: unknown, values: readonly T[]): T {
  if (!values.includes(v as T)) bad();
  return v as T;
}
function line(v: unknown, max: number, empty = false): string {
  if (typeof v !== 'string' || v.length > max || v !== v.trim() || /[\r\n]/.test(v)) bad();
  if (!empty && !v) bad();
  return v as string;
}
function checked(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}
function list(v: unknown, each: (item: unknown, i: number) => void): unknown[] {
  if (!Array.isArray(v) || !v.length || v.length > MAX_LIVE_RECORDS) bad();
  v.forEach(each);
  return v;
}
function ordered(items: unknown[], key: (item: Raw) => string): void {
  for (let i = 1; i < items.length; i++) if (key(items[i] as Raw) < key(items[i - 1] as Raw)) bad();
}

const LOCKS: GexLockId[] = ['evening', 'morning'];
const SIDES = ['long', 'short'] as const;
const STATUSES: ThesisStatus[] = [
  'planned',
  'waiting',
  'qualified',
  'active',
  'reset',
  'second-eligible',
  'exhausted',
  'invalidated',
  'completed',
  'abandoned',
];
const EXITS: AttemptExitKind[] = ['objective', 'stopped', 'flat', 'invalidated', 'reconciled'];
const ZONES: ZoneState[] = ['away', 'at', 'left'];
const CISD: CisdHow[] = ['range', 'body', 'double-tap', 'single-wick'];
const OBSERVED: ObservedKind[] = ['range', 'directional', 'candidate', 'confirmed'];
const SESSION_STOPS: SessionStop['reason'][] = [
  'daily-loss',
  'hard-stop',
  'invalidated',
  'finished',
];
const STOP_REASONS: StopReason[] = [...SESSION_STOPS, 'no-trade', 'reviewed'];
const STOP_CAUSES: StopCause[] = ['entry-cap', 'loss-run', 'logged-trade'];
const EVENT_KINDS: LiveEventKind[] = [
  'plan',
  'confirm',
  'lock',
  'rushed',
  'regime',
  'thesis',
  'retire',
  'attempt',
  'partial',
  'exit',
  'reset',
  'loss',
  'line',
  'taken',
  'stop',
];

/** "14:00": a New York time on the hour and minute. */
export function validTime(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{2}:\d{2}$/.test(v)) return false;
  const [h, m] = v.split(':').map(Number);
  return h < 24 && m < 60;
}

function checkPlan(v: unknown): void {
  const p = obj(
    v,
    [
      'why',
      'target',
      'target2',
      'invalidation',
      'where',
      'conditional',
      'event',
      'at',
      'lock',
      'confirmed',
      'carriedFrom',
    ],
    ['why', 'target', 'invalidation', 'where', 'conditional', 'at', 'lock'],
  );
  try {
    thesisLine(p.why, 'why');
  } catch {
    bad();
  }
  price(p.target);
  price(p.invalidation);
  if (p.target === p.invalidation) bad();
  const long = (p.target as number) > (p.invalidation as number);
  if (p.target2 !== undefined) {
    const second = price(p.target2);
    if (long ? second <= (p.target as number) : second >= (p.target as number)) bad();
  }
  line(p.where, WHERE_MAX, true);
  if (typeof p.conditional !== 'boolean') bad();
  if (p.event !== undefined) {
    const e = obj(p.event, ['name', 'time'], ['name', 'time']);
    line(e.name, WHERE_MAX);
    if (!validTime(e.time)) bad();
  }
  ts(p.at);
  if (p.lock !== null) oneOf(p.lock, LOCKS);
  if (p.confirmed !== undefined)
    list(p.confirmed, (c) => {
      const r = obj(c, ['lock', 'at'], ['lock', 'at']);
      oneOf(r.lock, LOCKS);
      ts(r.at);
    });
  if (p.carriedFrom !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(p.carriedFrom as string)) bad();
}

function checkLock(v: unknown): void {
  const l = obj(v, ['at', 'mode', 'limits'], ['at', 'mode', 'limits']);
  ts(l.at);
  oneOf(l.mode, ['practice', 'live'] as const);
  const keys = [
    'tradeRisk',
    'thesisRisk',
    'dailyLoss',
    'maxContracts',
    'pointValue',
    'tick',
    'accounts',
    'commission',
    'slippageTicks',
    'attemptsPerThesis',
    'cooldownMinutes',
    'resetMinutes',
  ];
  const m = obj(l.limits, keys, keys);
  dollars(m.tradeRisk);
  dollars(m.thesisRisk);
  dollars(m.dailyLoss);
  whole(m.maxContracts, 1, MAX_CONTRACTS);
  price(m.pointValue);
  price(m.tick);
  whole(m.accounts, 1, MAX_ACCOUNTS);
  if (m.commission !== null) dollars(m.commission, true);
  if (m.slippageTicks !== null) whole(m.slippageTicks, 0, 100);
  whole(m.attemptsPerThesis, 1, 2);
  whole(m.cooldownMinutes, 1, 240);
  whole(m.resetMinutes, 1, 240);
}

function checkThesis(v: unknown): string {
  const t = obj(
    v,
    [
      'id',
      'createdAt',
      'origin',
      'direction',
      'where',
      'target',
      'invalidation',
      'changed',
      'exception',
      'statusLog',
    ],
    ['id', 'createdAt', 'origin', 'direction', 'where', 'target', 'invalidation', 'statusLog'],
  );
  line(t.id, 20);
  ts(t.createdAt);
  oneOf(t.origin, ['plan', 'new'] as const);
  const direction = oneOf(t.direction, SIDES);
  line(t.where, WHERE_MAX, true);
  const target = price(t.target);
  const invalidation = price(t.invalidation);
  if (direction === 'long' ? target <= invalidation : target >= invalidation) bad();
  if (t.changed !== undefined) line(t.changed, 160);
  if (t.origin === 'new' && t.changed === undefined) bad();
  if (t.exception !== undefined) line(t.exception, EXCEPTION_MAX);
  const log = list(t.statusLog, (s) => {
    const r = obj(s, ['status', 'at', 'reason'], ['status', 'at']);
    oneOf(r.status, STATUSES);
    ts(r.at);
    if (r.reason !== undefined) line(r.reason, 160);
  });
  ordered(log, (s) => s.at as string);
  // Each step is one the transition table allows.
  for (let i = 1; i < log.length; i++)
    if (
      !TRANSITIONS[(log[i - 1] as Raw).status as ThesisStatus].includes(
        (log[i] as Raw).status as ThesisStatus,
      )
    )
      bad();
  return t.id as string;
}

function checkExit(v: unknown, openedAt: string): void {
  const e = obj(v, ['kind', 'at', 'result', 'loss', 'stillValid', 'answeredAt'], ['kind', 'at']);
  oneOf(e.kind, EXITS);
  if (ts(e.at) < openedAt) bad();
  if (e.result !== undefined) oneOf(e.result, ['loss', 'breakeven', 'gain'] as const);
  if (e.loss !== undefined) dollars(e.loss, true);
  if ((e.stillValid === undefined) !== (e.answeredAt === undefined)) bad();
  if (e.stillValid !== undefined && typeof e.stillValid !== 'boolean') bad();
  if (e.answeredAt !== undefined) ts(e.answeredAt);
}

function checkAttempt(v: unknown, theses: Set<string>, assessments: Set<string>): void {
  const a = obj(
    v,
    [
      'id',
      'thesisId',
      'assessmentId',
      'openedAt',
      'side',
      'entry',
      'stop',
      'contracts',
      'accounts',
      'plannedRisk',
      'costsIncluded',
      'practice',
      'taken',
      'partials',
      'exit',
    ],
    [
      'id',
      'thesisId',
      'assessmentId',
      'openedAt',
      'side',
      'entry',
      'stop',
      'contracts',
      'accounts',
      'plannedRisk',
      'costsIncluded',
      'practice',
    ],
  );
  line(a.id, 20);
  if (a.thesisId !== null && !theses.has(a.thesisId as string)) bad();
  if (a.assessmentId !== null && !assessments.has(a.assessmentId as string)) bad();
  const opened = ts(a.openedAt);
  oneOf(a.side, SIDES);
  price(a.entry);
  if (a.stop !== null) {
    const stop = price(a.stop);
    const entry = a.entry as number;
    if (a.side === 'long' ? stop >= entry : stop <= entry) bad();
  }
  whole(a.contracts, 1, MAX_CONTRACTS);
  whole(a.accounts, 1, MAX_ACCOUNTS);
  if (a.plannedRisk !== null) dollars(a.plannedRisk);
  // Risk needs a stop; a stop without a risk only on a trade logged outside the cockpit.
  if (a.plannedRisk !== null && a.stop === null) bad();
  if (a.plannedRisk === null && a.stop !== null && a.taken === undefined) bad();
  if (typeof a.costsIncluded !== 'boolean' || typeof a.practice !== 'boolean') bad();
  if (a.taken !== undefined) {
    const t = obj(a.taken, ['status', 'under', 'stop'], ['status']);
    line(t.status, 40);
    if (t.under !== undefined) line(t.under, 40);
    if (t.stop !== undefined) oneOf(t.stop, STOP_REASONS);
    if (a.assessmentId !== null) bad();
  } else if (a.thesisId === null || a.assessmentId === null) bad();
  if (a.partials !== undefined) {
    const partials = list(a.partials, (p) => {
      if (ts(p) < opened) bad();
    });
    if (partials.some((p, i) => i > 0 && (p as string) < (partials[i - 1] as string))) bad();
  }
  if (a.exit !== undefined) checkExit(a.exit, opened);
}

function checkAssessment(v: unknown, theses: Set<string>): string {
  const s = obj(
    v,
    [
      'id',
      'at',
      'thesisId',
      'zone',
      'setup',
      'fast',
      'timeframe',
      'cisd',
      'confirmed',
      'entry',
      'stop',
      'contracts',
    ],
    [
      'id',
      'at',
      'thesisId',
      'zone',
      'setup',
      'timeframe',
      'cisd',
      'confirmed',
      'entry',
      'stop',
      'contracts',
    ],
  );
  line(s.id, 20);
  ts(s.at);
  if (!theses.has(s.thesisId as string)) bad();
  if (s.zone !== null) oneOf(s.zone, ZONES);
  if (s.setup !== null) oneOf(s.setup, SETUP_IDS);
  if (s.fast !== undefined && (s.fast !== true || s.setup !== 'double-pierce')) bad();
  if (s.timeframe !== null) oneOf(s.timeframe, ['5m', '15m']);
  if (s.cisd !== null) oneOf(s.cisd, CISD);
  if (typeof s.confirmed !== 'boolean') bad();
  if (s.entry !== null) price(s.entry);
  if (s.stop !== null) price(s.stop);
  if (s.contracts !== null) whole(s.contracts, 1, MAX_CONTRACTS);
  return s.id as string;
}

/**
 * The thesis transitions allowed, from each state. A stopped attempt never goes straight back to
 * qualified: it resets, then a new qualification is needed; a final state is never left. A trade
 * logged outside the cockpit (`taken`) moves a waiting or eligible thesis to active without
 * qualifying it.
 */
export const TRANSITIONS: Record<ThesisStatus, ThesisStatus[]> = {
  planned: ['waiting', 'abandoned'],
  waiting: ['qualified', 'active', 'invalidated', 'abandoned'],
  qualified: ['active', 'waiting', 'invalidated', 'abandoned'],
  active: ['completed', 'reset', 'exhausted', 'invalidated'],
  reset: ['second-eligible', 'exhausted', 'invalidated', 'abandoned'],
  'second-eligible': ['qualified', 'active', 'exhausted', 'invalidated', 'abandoned'],
  exhausted: [],
  invalidated: [],
  completed: [],
  abandoned: [],
};

/**
 * Whether a session's live fields read back as written by this build, or are absent. `startedAt`
 * is the session's start (the lock's own time). Never throws.
 */
export function validLiveFields(s: Raw, startedAt: unknown): boolean {
  return checked(() => {
    if (s.plan !== undefined) checkPlan(s.plan);
    const started = s.lock !== undefined;
    if (started) {
      checkLock(s.lock);
      if ((s.lock as Raw).at !== startedAt) bad();
    }
    // Theses and setup readings come only with a started session; without one, only trades
    // logged after the fact.
    if (!started && [s.theses, s.assessments].some((x) => x !== undefined)) bad();
    if (!started && Array.isArray(s.attempts) && s.attempts.some((a) => !(a as Raw)?.taken)) bad();
    if (s.observed !== undefined) {
      const observed = list(s.observed, (r) => {
        const o = obj(r, ['kind', 'at'], ['kind', 'at']);
        oneOf(o.kind, OBSERVED);
        ts(o.at);
      });
      ordered(observed, (r) => r.at as string);
    }
    const theses = new Set<string>();
    if (s.theses !== undefined)
      list(s.theses, (t) => {
        const id = checkThesis(t);
        if (theses.has(id)) bad();
        theses.add(id);
      });
    const assessments = new Set<string>();
    if (s.assessments !== undefined) {
      const all = list(s.assessments, (a) => {
        const id = checkAssessment(a, theses);
        if (assessments.has(id)) bad();
        assessments.add(id);
      });
      ordered(all, (a) => a.at as string);
    }
    if (s.attempts !== undefined) {
      const ids = new Set<string>();
      const all = list(s.attempts, (a) => {
        checkAttempt(a, theses, assessments);
        const id = (a as Raw).id as string;
        if (ids.has(id)) bad();
        ids.add(id);
      });
      ordered(all, (a) => a.openedAt as string);
      // One position at a time.
      if (all.filter((a) => (a as Raw).exit === undefined).length > 1) bad();
    }
    if (s.cooldowns !== undefined) {
      const all = list(s.cooldowns, (c) => {
        const r = obj(c, ['kind', 'at', 'until'], ['kind', 'at', 'until']);
        oneOf(r.kind, ['rushed', 'loss'] as const);
        if (ts(r.until) <= ts(r.at)) bad();
      });
      ordered(all, (c) => c.at as string);
    }
    if (s.sessionStop !== undefined) {
      const r = obj(s.sessionStop, ['at', 'reason', 'until'], ['at', 'reason', 'until']);
      oneOf(r.reason, SESSION_STOPS);
      if (ts(r.until) <= ts(r.at)) bad();
    }
    if (s.lines !== undefined)
      list(s.lines, (l) => {
        const r = obj(l, ['label', 'kind', 'at', 'reason'], ['label', 'kind', 'at']);
        if (lineKey(line(r.label, WHERE_MAX)) !== r.label) bad();
        oneOf(r.kind, ['baiting', 'invalidated'] as const);
        ts(r.at);
        if (r.reason !== undefined) line(r.reason, 160);
        if (r.kind === 'invalidated' && r.reason === undefined) bad();
      });
    if (s.log !== undefined)
      list(s.log, (e) => {
        const r = obj(e, ['at', 'kind', 'detail'], ['at', 'kind']);
        ts(r.at);
        oneOf(r.kind, EVENT_KINDS);
        if (r.detail !== undefined) line(r.detail, 200);
      });
    // The caps come only with the lock; a cause only with a hard stop.
    if (s.lockedCaps !== undefined) {
      if (!started) bad();
      const keys = ['maxEntries', 'maxLossRun', 'dailyLossTotal'];
      const c = obj(s.lockedCaps, keys, keys);
      whole(c.maxEntries, 1, MAX_ENTRIES);
      whole(c.maxLossRun, 1, MAX_LOSS_RUN);
      if (c.dailyLossTotal !== null) dollars(c.dailyLossTotal);
    }
    if (s.stopCause !== undefined) {
      oneOf(s.stopCause, STOP_CAUSES);
      if ((s.sessionStop as Raw | undefined)?.reason !== 'hard-stop') bad();
    }
    if (s.refusals !== undefined) {
      const all = list(s.refusals, (r) => {
        const o = obj(r, ['at', 'status'], ['at', 'status']);
        ts(o.at);
        oneOf(o.status, STATUS_CODES);
      });
      ordered(all, (r) => r.at as string);
    }
  });
}

/** The cockpit's status codes, in the order `STATUS_TABLE` checks them (`trading-status.ts`). */
export const STATUS_CODES = [
  'LOAD_FAILED',
  'RECONCILE_POSITION',
  'IN_POSITION',
  'SESSION_STOPPED',
  'UNKNOWN_EXPOSURE',
  'COOLDOWN',
  'PRACTICE_ONLY',
  'REVIEW_FIRST',
  'NO_BIAS',
  'NO_PLAN',
  'NOT_STARTED',
  'OUTSIDE_WINDOW',
  'REGIME_RANGE',
  'THESIS_EXHAUSTED',
  'THESIS_COMPLETED',
  'THESIS_INVALIDATED',
  'NO_THESIS',
  'LINE_BLOCKED',
  'RESET_ANSWER',
  'SECOND_ATTEMPT_WAIT',
  'PLAN_RECONFIRM',
  'MISSED',
  'WAITING_ZONE',
  'WAITING_SETUP',
  'SETUP_FORMING',
  'CONFIRMATION_INCOMPLETE',
  'RISK_NEEDED',
  'RISK_BLOCKED',
  'CHECKS_COMPLETE',
] as const;

export type StatusCode = (typeof STATUS_CODES)[number];

/**
 * Whether a trade logged after the fact was taken outside the checks: the status then did not
 * allow an entry (anything but SETUP CHECKS COMPLETE: a stop, a cooldown, a retired idea, a cap,
 * a restriction or a missing plan), or its risk per account was above the risk per trade, or not
 * known.
 */
export function takenOutsideChecks(
  status: string,
  plannedRisk: number | null,
  accounts: number,
  limits: Pick<LiveLimits, 'tradeRisk'> | null,
): boolean {
  return loggedOutside(status, plannedRisk, accounts, limits) !== null;
}

/**
 * How a trade logged after the fact was outside the checks (`takenOutsideChecks`), or null when it
 * was not: entries were held, its risk was not known, or it was above the risk per trade.
 */
export function loggedOutside(
  status: string,
  plannedRisk: number | null,
  accounts: number,
  limits: Pick<LiveLimits, 'tradeRisk'> | null,
): 'held' | 'unknown-risk' | 'over-risk' | null {
  if (status !== 'CHECKS_COMPLETE') return 'held';
  if (plannedRisk === null || !limits) return 'unknown-risk';
  return Math.round((plannedRisk * 100) / accounts) > Math.round(limits.tradeRisk * 100)
    ? 'over-risk'
    : null;
}

/**
 * Statuses after a failed attempt or a retired idea (a cooldown here is a loss cooldown: under an
 * I FEEL RUSHED one alone the status beneath it counts, `taken.under`): a trade taken then is a
 * revenge re-entry.
 */
const REVENGE: string[] = [
  'COOLDOWN',
  'RESET_ANSWER',
  'SECOND_ATTEMPT_WAIT',
  'THESIS_EXHAUSTED',
  'THESIS_INVALIDATED',
  'LINE_BLOCKED',
  'UNKNOWN_EXPOSURE',
];

/** A hard violation the live records point to, by the key `VIOLATION_IDS` maps to its ID. */
export type LiveViolation =
  | 'revenge'
  | 'afterHardStop'
  | 'noInvalidation'
  | 'noNamedSetup'
  | 'againstBias'
  | 'overThesisRisk'
  | 'overDailyLoss';

/** Stops after which a trade is Traded after the hard stop: never a finish or an invalidated thesis. */
const HARD_STOPS: StopReason[] = ['hard-stop', 'daily-loss'];

/**
 * The hard violations a session's attempts point to, derived from the records alone: a trade
 * taken after a hard stop or the daily loss limit stopped the session (after the hard stop; never
 * after a finish or an invalidated thesis), during a loss cooldown, a reset or on a
 * retired idea or line (revenge), without a stop (no invalidation), outside the cockpit (no named
 * setup recorded before it), against the bias without a recorded exception, with planned risk
 * above the thesis budget, or with losses above the daily loss limit (across accounts, as locked).
 */
export function liveViolations(
  s: LiveFields & { bias?: 'bullish' | 'bearish' | 'unclear' | null },
): LiveViolation[] {
  const attempts = s.attempts ?? [];
  const found = new Set<LiveViolation>();
  const exception = (a: Attempt) => !!s.theses?.find((t) => t.id === a.thesisId)?.exception;
  const biasSide = s.bias === 'bullish' ? 'long' : s.bias === 'bearish' ? 'short' : null;
  for (const a of attempts) {
    if (a.taken?.stop && HARD_STOPS.includes(a.taken.stop)) found.add('afterHardStop');
    if (a.taken && REVENGE.includes(a.taken.under ?? a.taken.status)) found.add('revenge');
    if (a.stop === null) found.add('noInvalidation');
    if (a.taken) found.add('noNamedSetup');
    if (biasSide && a.side !== biasSide && !exception(a)) found.add('againstBias');
  }
  const limits = s.lock?.limits;
  if (limits) {
    const thesisBudget = limits.thesisRisk * limits.accounts;
    if (attempts.some((a) => a.plannedRisk !== null && a.plannedRisk > thesisBudget))
      found.add('overThesisRisk');
    const total = s.lockedCaps
      ? dailyLossTotalOf({ ...limits, ...s.lockedCaps })
      : limits.dailyLoss * limits.accounts;
    if (lossOf(attempts).amount > total) found.add('overDailyLoss');
  }
  return [...found];
}
