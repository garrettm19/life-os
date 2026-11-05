import { nextCandle, nyClockText, nyInstant } from './market-clock';
import { RiskSettings, TradingProfile, displayDate } from './model';
import type { SessionCaps } from './trading-live-model';

// The safeguards set in Your limits that hold across a session and between sessions: the
// session's entry cap and loss run, a raise that waits for the next candle's session, the money
// question before live trading, and the clean sessions counted before live trading and before
// more accounts. Each is a rule on the stored profile and records; none of them reads a market, a
// broker or an account, and none is a broker lockout. Nothing here is a level, a badge or a score:
// the counts are plain facts from the reviews.

/** Entries per session when the profile sets none. */
export const DEFAULT_MAX_ENTRIES = 3;
/** Losses in a row that end the session when the profile sets none. */
export const DEFAULT_LOSS_RUN = 2;
/** The I FEEL RUSHED cooldown when the profile sets none. */
export const DEFAULT_COOLDOWN_MINUTES = 25;

/** The session's entry cap (3 when not set). */
export function maxEntriesOf(profile: TradingProfile): number {
  return profile.maxEntries ?? DEFAULT_MAX_ENTRIES;
}

/** Losses in a row that end the session (2 when not set). */
export function maxLossRunOf(profile: TradingProfile): number {
  return profile.maxLossRun ?? DEFAULT_LOSS_RUN;
}

// A raise waits for the next candle's session.

/** Every setting a raise waits on, as saved on the profile. */
export function riskSettings(profile: TradingProfile): RiskSettings {
  return {
    tradeRisk: profile.risk?.tradeRisk ?? null,
    thesisRisk: profile.risk?.thesisRisk ?? null,
    dailyLoss: profile.risk?.dailyLoss ?? null,
    dailyLossTotal: profile.dailyLossTotal ?? null,
    maxContracts: profile.risk?.maxContracts ?? null,
    accounts: profile.accounts ?? 1,
    maxEntries: maxEntriesOf(profile),
    maxLossRun: maxLossRunOf(profile),
    cooldownMinutes: profile.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES,
    ...(profile.flatBy !== undefined && { flatBy: profile.flatBy }),
  };
}

const optional = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.min(a, b);

/**
 * The stricter of two sets of session caps, cap by cap: the fewer entries, the shorter loss run,
 * and the lower total across accounts (none is the loosest). The one rule for every cap read
 * against two values: locked and current, or before and after a raise.
 */
export function stricterCaps(a: SessionCaps, b: SessionCaps): SessionCaps {
  return {
    maxEntries: Math.min(a.maxEntries, b.maxEntries),
    maxLossRun: Math.min(a.maxLossRun, b.maxLossRun),
    dailyLossTotal: optional(a.dailyLossTotal, b.dailyLossTotal),
  };
}

/** The earlier of two flat-by times; none is the loosest. */
const earlier = (a: string | undefined, b: string | undefined) =>
  a === undefined ? b : b === undefined ? a : a < b ? a : b;

/**
 * The stricter of two settings, key by key: the lower limit, the longer cooldown, the earlier
 * flat-by time, the stricter caps (`stricterCaps`). A required limit cleared now stays cleared (it holds every entry); one
 * not set before takes the value set now (setting a limit for the first time never waits). Keys in
 * the order `riskSettings` writes them, so a profile saved again reads back byte for byte.
 */
export function stricterSettings(before: RiskSettings, now: RiskSettings): RiskSettings {
  const required = (a: number | null, b: number | null) =>
    b === null ? null : a === null ? b : Math.min(a, b);
  const caps = stricterCaps(before, now);
  return {
    tradeRisk: required(before.tradeRisk, now.tradeRisk),
    thesisRisk: required(before.thesisRisk, now.thesisRisk),
    dailyLoss: required(before.dailyLoss, now.dailyLoss),
    dailyLossTotal: caps.dailyLossTotal,
    maxContracts: required(before.maxContracts, now.maxContracts),
    accounts: Math.min(before.accounts, now.accounts),
    maxEntries: caps.maxEntries,
    maxLossRun: caps.maxLossRun,
    cooldownMinutes: Math.max(before.cooldownMinutes, now.cooldownMinutes),
    ...flatByOf(earlier(before.flatBy, now.flatBy)),
  };
}

const flatByOf = (flatBy: string | undefined) => (flatBy === undefined ? {} : { flatBy });

/**
 * The settings `after` loosens against `before`: the raises. A flat-by time cleared is one,
 * though `after` no longer has the key.
 */
export function raisedKeys(before: RiskSettings, after: RiskSettings): (keyof RiskSettings)[] {
  const strict = stricterSettings(before, after);
  const keys = new Set([...Object.keys(strict), ...Object.keys(after)] as (keyof RiskSettings)[]);
  return [...keys].filter((k) => strict[k] !== after[k]);
}

/**
 * The settings that hold on a candle: the saved ones, or, on the candle a raise was saved on (and
 * any before it), the stricter of them and those that stood before the raise. So a raise saved on
 * a candle, even before its session starts, applies from the next candle's session; a cut applies
 * at once.
 */
export function effectiveSettings(profile: TradingProfile, candle: string): RiskSettings {
  const now = riskSettings(profile);
  const raised = profile.raisedOn;
  return raised && candle <= raised.candle ? stricterSettings(raised.before, now) : now;
}

/** The limits that must be set before a session starts: blank, one holds every entry. */
const REQUIRED = ['tradeRisk', 'thesisRisk', 'dailyLoss', 'maxContracts'] as const;

/**
 * The profile `next` as saved on `candle`, with the raise it waits on (`raisedOn`): the settings
 * that hold on the candle, as they stood before its first change and lowered by any cut since,
 * kept while anything is above them or a required limit they had is cleared, and dropped once
 * neither is so or the candle has passed. A cleared limit keeps its earlier value there, so
 * setting it again on the same candle is read against that value and a higher one waits; only a
 * limit blank at the candle's start is set for the first time. Saving the same profile again
 * changes nothing. The one place a raise is recorded.
 */
export function withRaises(
  previous: TradingProfile | undefined,
  next: TradingProfile,
  candle: string,
): TradingProfile {
  const rest = { ...next };
  delete rest.raisedOn;
  if (!previous) return rest;
  const waiting =
    previous.raisedOn && candle <= previous.raisedOn.candle ? previous.raisedOn : null;
  // What held, a required limit cleared earlier on this candle read at the value it had before.
  const held = effectiveSettings(previous, candle);
  for (const k of REQUIRED) if (held[k] === null) held[k] = waiting?.before[k] ?? null;
  const now = riskSettings(rest);
  const cleared = REQUIRED.some((k) => held[k] !== null && now[k] === null);
  if (!raisedKeys(held, now).length && !cleared) return rest;
  const before = stricterSettings(held, now);
  for (const k of REQUIRED) if (now[k] === null) before[k] = held[k];
  return { ...rest, raisedOn: { candle, before } };
}

const SETTING_WORDS: Record<keyof RiskSettings, string> = {
  tradeRisk: 'risk per trade',
  thesisRisk: 'thesis budget',
  dailyLoss: 'session max loss',
  dailyLossTotal: 'total across accounts',
  maxContracts: 'contract limit',
  accounts: 'accounts',
  maxEntries: 'entries per session',
  maxLossRun: 'losses in a row',
  cooldownMinutes: 'cooldown',
  flatBy: 'flat-by time',
};

/**
 * "Raised on this candle: risk per trade and accounts. The new values apply from the session of
 * Mon, Nov 2; until then the earlier ones hold.", or null when no raise waits on this candle.
 */
export function waitingRaiseLine(profile: TradingProfile, candle: string): string | null {
  const raised = profile.raisedOn;
  if (!raised || candle > raised.candle) return null;
  const keys = raisedKeys(raised.before, riskSettings(profile));
  if (!keys.length) return null;
  const words = keys.map((k) => SETTING_WORDS[k]);
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0];
  return `Raised on this candle: ${list}. The new values apply from the session of ${displayDate(nextCandle(candle))}; until then the earlier ones hold.`;
}

// The money question, asked each time live trading is turned on.

/** Asked when live trading is turned on, every time. No amount is asked or shown. */
export const MONEY_QUESTION =
  'Is the money for these accounts money you have set aside for this — not credit, and not money you need for bills or debt payments?';
/** Said when the answer is No: live trading stays off. */
export const MONEY_NO_LINE =
  'Then live trading stays off. Practice keeps every rule, and live can wait.';
/** One static line of general information shown with it, never advice. */
export const MONEY_INFO_LINE =
  'General information, not advice: a nonprofit credit counselor can help you plan around debt, free or at low cost (in the US, NFCC.org).';

// Clean sessions before live trading and before more accounts, counted from the records.

/** Clean practice sessions needed before live trading can be turned on. */
export const PRACTICE_SESSIONS_FOR_LIVE = 30;

/**
 * Each step up in accounts and the clean live sessions it needs at the current count. There is no
 * 4: 3 goes to 5. Above 5 no step is offered; lowering is always allowed.
 */
export const ACCOUNT_STEPS: { from: number; to: number; sessions: number }[] = [
  { from: 1, to: 2, sessions: 20 },
  { from: 2, to: 3, sessions: 20 },
  { from: 3, to: 5, sessions: 30 },
  { from: 4, to: 5, sessions: 30 },
];

/**
 * A session started on the live cockpit, read with its candle's review: practice or live, the
 * accounts it locked, whether a review was saved for it (a day away is not one) and whether it has
 * a hard violation (the review's, or before one is saved, those its records point to). Sessions
 * from before the live cockpit have no mode and are never one.
 */
export type GateSession = {
  candle: string;
  mode: 'practice' | 'live';
  accounts: number;
  reviewed: boolean;
  violated: boolean;
};

const clean = (s: GateSession) => s.reviewed && !s.violated;

/** Clean practice sessions: reviewed, practice, no hard violation. */
export function cleanPracticeSessions(sessions: GateSession[]): number {
  return sessions.filter((s) => s.mode === 'practice' && clean(s)).length;
}

/**
 * Clean live sessions at `accounts`, counted after the latest live session with a hard violation
 * (that one restarts every count, reviewed or not yet).
 */
export function cleanLiveSessions(sessions: GateSession[], accounts: number): number {
  const sorted = [...sessions].sort((a, b) => (a.candle < b.candle ? -1 : 1));
  let count = 0;
  for (const s of sorted) {
    if (s.mode !== 'live') continue;
    if (s.violated) count = 0;
    else if (clean(s) && s.accounts === accounts) count++;
  }
  return count;
}

/** Why live trading cannot be turned on yet for the practice it needs, or null. */
export function practiceGateProblem(sessions: GateSession[]): string | null {
  const done = cleanPracticeSessions(sessions);
  return done >= PRACTICE_SESSIONS_FOR_LIVE
    ? null
    : `Live trading waits for ${PRACTICE_SESSIONS_FOR_LIVE} clean practice sessions: ${done} of ${PRACTICE_SESSIONS_FOR_LIVE} so far.`;
}

/** The next step up from `from` accounts, or null when none is offered. */
export function accountStep(from: number): { to: number; sessions: number } | null {
  const step = ACCOUNT_STEPS.find((s) => s.from === from);
  return step ? { to: step.to, sessions: step.sessions } : null;
}

/**
 * Why the accounts cannot go from `from` to `to`, or null: lowering is always allowed; raising
 * goes one step (1 → 2 → 3 → 5) once the clean live sessions at the current count are recorded.
 */
export function accountsRaiseProblem(
  sessions: GateSession[],
  from: number,
  to: number,
): string | null {
  if (to <= from) return null;
  const step = accountStep(from);
  if (!step) return `More than ${from} accounts is not offered.`;
  if (to !== step.to) return `Accounts go up one step at a time: ${from} to ${step.to} next.`;
  const done = cleanLiveSessions(sessions, from);
  return done >= step.sessions
    ? null
    : `${step.to} accounts need ${step.sessions} clean live sessions at ${from}: ${done} of ${step.sessions} so far.`;
}

/**
 * The gate lines Your limits shows, plainly: "Clean practice sessions: 12 of 30" and, when a step
 * up is offered, "Clean live sessions at 1 account: 0 of 20 (for 2 accounts)".
 */
export function gateLines(sessions: GateSession[], accounts: number): string[] {
  const lines = [
    `Clean practice sessions: ${Math.min(cleanPracticeSessions(sessions), PRACTICE_SESSIONS_FOR_LIVE)} of ${PRACTICE_SESSIONS_FOR_LIVE}, before live trading.`,
  ];
  const step = accountStep(accounts);
  if (step)
    lines.push(
      `Clean live sessions at ${accounts} account${accounts === 1 ? '' : 's'}: ${Math.min(cleanLiveSessions(sessions, accounts), step.sessions)} of ${step.sessions}, before ${step.to} accounts.`,
    );
  return lines;
}

// The flat-by time: when the firm's rules want the trader flat on each candle.

/** Minutes before the flat-by time that an open trade is warned. */
export const FLAT_WARN_MINUTES = 15;

/** Where an instant stands against the candle's flat-by time. */
export type FlatByPhase = {
  /** "3:55 PM New York" (example). */
  text: string;
  /** The flat-by instant on the candle. */
  at: number;
  /** `soon` within the warning minutes before it, `past` from it to the candle's end. */
  phase: 'before' | 'soon' | 'past';
};

/**
 * The flat-by time as it holds on `candle` (a later time, or none, saved on the candle waits for
 * the next candle's session like any raise, `effectiveSettings`) and where `now` stands against
 * it, or null when none is set. It is a New York time on the candle's own date, DST included.
 */
export function flatByPhase(
  profile: TradingProfile,
  candle: string,
  now: number,
): FlatByPhase | null {
  const flatBy = effectiveSettings(profile, candle).flatBy;
  if (flatBy === undefined) return null;
  const [h, m] = flatBy.split(':').map(Number);
  const at = nyInstant(candle, h * 60 + m);
  const phase = now >= at ? 'past' : now >= at - FLAT_WARN_MINUTES * 60_000 ? 'soon' : 'before';
  return { text: `${nyClockText(at)} New York`, at, phase };
}
