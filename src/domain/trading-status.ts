import { nyClockText } from './market-clock';
import { State, displayDate } from './model';
import { MAX_CONTRACTS } from './records';
import {
  DailyBias,
  DisciplineDraft,
  TradingSession,
  directional,
  liveWindow,
  sideOf,
} from './trading';
import {
  APP_LEVEL_LINE,
  ActiveStop,
  CHART_LINE,
  LINE_WORDS,
  LIVE_OFF_NEXT_LINE,
  Left,
  LineInfo,
  LiveContext,
  RANGE_NOTE,
  SizeProblem,
  TradeSize,
  accountsOf,
  activeCooldown,
  activeStop,
  append,
  changeSession,
  checkStops,
  contractRiskCents,
  cooldownLine,
  currentAssessment,
  currentThesis,
  dailyLeft,
  eventInstant,
  exposureUnknown,
  hardStop,
  liveLimits,
  liveTradingOn,
  lineStatus,
  logged,
  moveThesis,
  notBefore,
  notReviewed,
  observedRegime,
  openAttempt,
  planCurrent,
  planProblems,
  practiceReasons,
  runningCooldowns,
  sessionLoss,
  sizeTrade,
  stopLine,
  thesisAttempts,
  thesisLeft,
  withThesis,
} from './trading-live';
import {
  Assessment,
  Attempt,
  Cooldown,
  FINAL_STATUSES,
  LiveLimits,
  LossTotal,
  ObservedRegime,
  StatusCode,
  Thesis,
  ThesisStatus,
  TradingPlan,
  failedAttempt,
  lineKey,
  lossRunOf,
  takenOutsideChecks,
  thesisStatus,
  whereText,
} from './trading-live-model';
import { priceProblem, priceText } from './trading-prices';
import { flatByPhase } from './trading-safeguards';
import { CISD_RULE, RETAKE_RULE_MISSING, retakeRuleSet } from './trading-strategy';

// The cockpit's one status: what the trader may do now, read from the stored records and the
// clock by one function that every screen uses (the live cockpit, Preparation, Today's trading
// row, Rules & GEX and the review). The first row of `STATUS_TABLE` that holds wins. It never says
// a trade is approved: the best it says is that the setup checks are complete, as the trader's
// own report. Practice only (live trading off, a pause, a study-only day, a major event) is a
// banner over the status, never a status that hides the rest: practice ignores the live windows
// and keeps every other rule. Tests: __tests__/trading-status.test.ts, with cases for the table's
// order and for its rows.

/**
 * What a status rests on, for its honest label: `app` is held by what the app recorded and the
 * clock (a stop, a cooldown, a pause, a window, a review, the attempts used), whatever is reported
 * next; `report` rests on the trader's own read of the market (the regime chip, the zone, the
 * setup, the prices, a line marked). Neither is a broker lockout.
 */
export type StatusBasis = 'app' | 'report';

export type StatusRow = {
  code: StatusCode;
  basis: StatusBasis;
  title: string;
  /** What makes the row hold. */
  when: string;
  /** How missing or unknown data reads. */
  missing: string;
  /** A banner over the status rather than the status itself. */
  banner?: true;
};

/** Every status, in precedence order (the first that holds wins). UI, docs and tests read this. */
export const STATUS_TABLE: StatusRow[] = [
  {
    code: 'LOAD_FAILED',
    basis: 'app',
    title: "NO ENTRY — THE SESSION CAN'T BE READ",
    when: "This candle's or the previous candle's record could not be read.",
    missing: 'An unreadable record is never taken for an empty one: nothing can be entered.',
  },
  {
    code: 'RECONCILE_POSITION',
    basis: 'app',
    title: 'RECONCILE OPEN POSITION',
    when: "A trade from an earlier candle's session has no outcome.",
    missing: 'Record its outcome, or Closed in broker earlier.',
  },
  {
    code: 'IN_POSITION',
    basis: 'app',
    title: 'IN POSITION — MANAGE TO PLAN',
    when: 'A trade is open (in a live session, it warns 15 minutes before the flat-by time and asks for the outcome after it).',
    missing: '—',
  },
  {
    code: 'SESSION_STOPPED',
    basis: 'app',
    title: 'SESSION ENDED — NO FURTHER TRADING',
    when: 'A stop on this candle (a session cap reached included), or a hard stop of the previous candle until its 9:30 AM window, or the day reviewed.',
    missing: 'A record ended by an earlier build counts as its stop.',
  },
  {
    code: 'UNKNOWN_EXPOSURE',
    basis: 'app',
    title: 'NO ENTRY — UNKNOWN EXPOSURE',
    when: 'A trade with no stop or no known risk, or a closed one with no known loss, on this candle or an earlier one.',
    missing: 'Unknown is never zero: report the loss.',
  },
  {
    code: 'COOLDOWN',
    basis: 'app',
    title: 'COOLDOWN — STEP AWAY',
    when: 'An I FEEL RUSHED or loss cooldown runs (this candle or the previous one).',
    missing: '—',
  },
  {
    code: 'PRACTICE_ONLY',
    basis: 'app',
    title: 'PAUSED — PRACTICE ONLY',
    when: 'Live trading off, a lost account set, a pause in Programs, a study-only day, a major event, or a session started as practice.',
    missing: 'Live trading not set reads as off.',
    banner: true,
  },
  {
    code: 'REVIEW_FIRST',
    basis: 'app',
    title: 'NO TRADE — REVIEW YOUR LAST SESSION',
    when: 'Before the start, an earlier session that ran has no review.',
    missing: '—',
  },
  {
    code: 'NO_BIAS',
    basis: 'report',
    title: 'NO TRADE — HTF UNCLEAR',
    when: 'The bias is Unclear.',
    missing: 'No bias set reads as preparation incomplete.',
  },
  {
    code: 'NO_PLAN',
    basis: 'app',
    title: 'NO TRADE — PREPARATION INCOMPLETE',
    when: 'Before the start: no bias, no plan, or a limit not set.',
    missing: 'Each missing field is listed.',
  },
  {
    code: 'NOT_STARTED',
    basis: 'app',
    title: "NOT STARTED — TAP I'M READY",
    when: 'The plan is ready and the session has not started.',
    missing: '—',
  },
  {
    code: 'OUTSIDE_WINDOW',
    basis: 'app',
    title: 'WAIT — NO LIVE WINDOW',
    when: 'A live session outside the 6 PM and 9:30 AM windows, or past the flat-by time on the candle (practice skips this).',
    missing: '—',
  },
  {
    code: 'REGIME_RANGE',
    basis: 'report',
    title: 'NO ENTRY — RANGE / CHOP',
    when: 'The latest regime chip is Range / chop.',
    missing: 'No regime chip never blocks.',
  },
  {
    code: 'THESIS_EXHAUSTED',
    basis: 'app',
    title: 'THESIS EXHAUSTED — THIS IDEA IS RETIRED',
    when: 'The current thesis used its attempts or its budget, and no thesis is active.',
    missing: '—',
  },
  {
    code: 'THESIS_COMPLETED',
    basis: 'app',
    title: 'THESIS COMPLETE — OBJECTIVE REACHED',
    when: 'The current thesis reached its objective.',
    missing: '—',
  },
  {
    code: 'THESIS_INVALIDATED',
    basis: 'app',
    title: 'THESIS INVALIDATED — THIS IDEA IS RETIRED',
    when: 'The current thesis was structurally invalidated.',
    missing: '—',
  },
  {
    code: 'NO_THESIS',
    basis: 'app',
    title: 'NO ACTIVE THESIS',
    when: 'The current thesis was retired by hand.',
    missing: '—',
  },
  {
    code: 'LINE_BLOCKED',
    basis: 'report',
    title: 'NO ENTRY — LINE IS BAITING',
    when: "The thesis's line is baiting (two failures, or marked) or invalidated.",
    missing: '—',
  },
  {
    code: 'RESET_ANSWER',
    basis: 'app',
    title: 'RESET — IS THE THESIS STILL VALID?',
    when: 'After a failed attempt and its cooldown, the reset is not answered.',
    missing: '—',
  },
  {
    code: 'SECOND_ATTEMPT_WAIT',
    basis: 'app',
    title: 'WAIT — NEW SETUP NEEDED FOR ATTEMPT 2',
    when: 'Eligible for a second attempt, with no setup reading since the failed one.',
    missing: 'The reading before the failure never counts.',
  },
  {
    code: 'PLAN_RECONFIRM',
    basis: 'app',
    title: 'NO ENTRY — CONFIRM YOUR PLAN FOR THIS GEX',
    when: 'The plan was made under an earlier GEX lock and not confirmed for this one.',
    missing: '—',
  },
  {
    code: 'MISSED',
    basis: 'report',
    title: 'MISSED ENTRY — DO NOT CHASE',
    when: 'Price left the area without an entry.',
    missing: '—',
  },
  {
    code: 'WAITING_ZONE',
    basis: 'report',
    title: 'WAITING FOR ZONE',
    when: 'Price is away from the area, or not reported yet.',
    missing: 'No reading reads as away.',
  },
  {
    code: 'WAITING_SETUP',
    basis: 'report',
    title: 'WAITING FOR SETUP',
    when: 'At the area, with no named setup or chart.',
    missing: '—',
  },
  {
    code: 'SETUP_FORMING',
    basis: 'report',
    title: 'SETUP FORMING',
    when: 'A named setup on its chart, not confirmed.',
    missing: '—',
  },
  {
    code: 'CONFIRMATION_INCOMPLETE',
    basis: 'report',
    title: 'CONFIRMATION INCOMPLETE',
    when: 'A CISD confirmed by a single wick, or Setup B without its retake rule.',
    missing: '—',
  },
  {
    code: 'RISK_NEEDED',
    basis: 'report',
    title: 'NO ENTRY — NO STRUCTURAL STOP',
    when: 'The setup is confirmed; the entry or the stop is not entered.',
    missing: 'No stop, no trade.',
  },
  {
    code: 'RISK_BLOCKED',
    basis: 'app',
    title: 'NO ENTRY — RISK',
    when: 'The size check fails: price, side, chasing, unknown loss, budgets, or the stop too wide.',
    missing: 'An unknown loss blocks; it is never counted as zero.',
  },
  {
    code: 'CHECKS_COMPLETE',
    basis: 'report',
    title: 'SETUP CHECKS COMPLETE — SELF-REPORTED',
    when: 'Everything above passes.',
    missing: '—',
  },
];

const TITLE = Object.fromEntries(STATUS_TABLE.map((r) => [r.code, r.title])) as Record<
  StatusCode,
  string
>;
const BASIS = Object.fromEntries(STATUS_TABLE.map((r) => [r.code, r.basis])) as Record<
  StatusCode,
  StatusBasis
>;

/**
 * How a status looks: a hard stop, a restriction (no entry until something is done or ends), a
 * wait for the market, checks complete, or a position.
 */
export type Tone = 'stop' | 'block' | 'wait' | 'ready' | 'position';

const TONE: Partial<Record<StatusCode, Tone>> = {
  LOAD_FAILED: 'stop',
  RECONCILE_POSITION: 'position',
  IN_POSITION: 'position',
  SESSION_STOPPED: 'stop',
  UNKNOWN_EXPOSURE: 'stop',
  COOLDOWN: 'block',
  REVIEW_FIRST: 'block',
  NO_BIAS: 'block',
  NO_PLAN: 'block',
  REGIME_RANGE: 'block',
  THESIS_EXHAUSTED: 'stop',
  THESIS_COMPLETED: 'block',
  THESIS_INVALIDATED: 'stop',
  NO_THESIS: 'block',
  LINE_BLOCKED: 'stop',
  PLAN_RECONFIRM: 'block',
  MISSED: 'block',
  RISK_NEEDED: 'block',
  RISK_BLOCKED: 'block',
  CHECKS_COMPLETE: 'ready',
};

/** What the status was read from, for the cockpit's blocks. */
export type LiveFacts = {
  mode: 'practice' | 'live';
  /** Why the session is practice only; empty when live. */
  practiceWhy: string[];
  started: boolean;
  bias: DailyBias | null;
  plan: TradingPlan | null;
  /** The plan stands for the GEX lock open now. */
  planCurrent: boolean;
  limits: LiveLimits | null;
  thesis: Thesis | null;
  thesisStatus: ThesisStatus | null;
  attemptsUsed: number;
  attemptsMax: number;
  thesisLeft: Left | null;
  dailyLeft: Left | null;
  sessionLoss: LossTotal;
  /** The session's entries so far (one execution is one; a partial exit none), for its cap. */
  entries: number;
  /** The losses in a row the session's closed attempts end on (`lossRunOf`), for its cap. */
  lossRun: number;
  /** The current thesis's line, or the plan's before the start. */
  line: LineInfo | null;
  regime: ObservedRegime | null;
  assessment: Assessment | null;
  open: Attempt | null;
  cooldown: Cooldown | null;
  stop: ActiveStop | null;
  size: TradeSize | null;
  sizeProblem: SizeProblem | null;
};

export type TradeStatus = {
  code: StatusCode;
  title: string;
  reason: string;
  next: string;
  tone: Tone;
  /** What the status rests on (`StatusBasis`), for its label. */
  basis: StatusBasis;
  /** Practice only: entries are simulated (`banner` says so over the status). */
  practice: boolean;
  banner: string | null;
  /** The plan's major event, short ("FOMC 2:00 PM"), or null: shown with the status all day. */
  event: string | null;
  /** Short lines under the status: why practice, honest labels, the area's note. */
  notes: string[];
  facts: LiveFacts;
};

/** The setup reading is complete: at the area, named on its chart, confirmed, the rules met. */
function readingProblem(
  a: Assessment | null,
  ctx: LiveContext,
): { code: StatusCode; reason: string; next: string } | null {
  if (!a?.setup || !a.timeframe)
    return {
      code: 'WAITING_SETUP',
      reason: 'No qualified 5m/15m setup named yet.',
      next: 'Name the setup and its chart when it forms.',
    };
  if (!a.confirmed)
    return {
      code: 'SETUP_FORMING',
      reason: 'The setup is not confirmed.',
      next: 'Wait for the confirmation. No setup, no trade.',
    };
  if (a.cisd === 'single-wick')
    return {
      code: 'CONFIRMATION_INCOMPLETE',
      reason: CISD_RULE,
      next: 'Wait for a valid CISD confirmation.',
    };
  if (a.setup === 'sweep-retake' && !retakeRuleSet(ctx.profile))
    return {
      code: 'CONFIRMATION_INCOMPLETE',
      reason: RETAKE_RULE_MISSING,
      next: 'Setup B cannot complete yet.',
    };
  return null;
}

/**
 * The cockpit's status now (`STATUS_TABLE`, the first row that holds), with the facts it was read
 * from. Pure: the same context always gives the same status.
 */
export function tradeStatus(ctx: LiveContext): TradeStatus {
  const s = ctx.session;
  const practiceWhy = practiceReasons(ctx);
  const practice = practiceWhy.length > 0;
  const limits = liveLimits(s, ctx.profile);
  const thesis = s.lock ? currentThesis(s) : null;
  const status = thesis ? thesisStatus(thesis) : null;
  const final = !!status && FINAL_STATUSES.includes(status);
  const assessment = thesis && !final ? currentAssessment(s, thesis) : null;
  const thesisL = thesis && limits ? thesisLeft(s, thesis, limits) : null;
  const dailyL = limits ? dailyLeft(s, limits) : null;
  const open = openAttempt(ctx);
  const sized =
    thesis && assessment && limits && thesisL && dailyL
      ? sizeTrade({
          side: thesis.direction,
          entry: assessment.entry,
          stop: assessment.stop,
          target: thesis.target,
          contracts: assessment.contracts,
          limits,
          thesisLeft: thesisL,
          dailyLeft: dailyL,
        })
      : null;
  const where = thesis?.where ?? s.plan?.where;
  const facts: LiveFacts = {
    mode: practice ? 'practice' : 'live',
    practiceWhy,
    started: !!s.lock,
    bias: s.bias ?? null,
    plan: s.plan ?? null,
    planCurrent: !s.plan || planCurrent(s.plan, ctx.now),
    limits,
    thesis,
    thesisStatus: status,
    attemptsUsed: thesis ? thesisAttempts(s, thesis.id).length : 0,
    attemptsMax: limits?.attemptsPerThesis ?? 0,
    thesisLeft: thesisL,
    dailyLeft: dailyL,
    sessionLoss: sessionLoss(s),
    entries: s.attempts?.length ?? 0,
    lossRun: lossRunOf(s.attempts ?? []),
    line: where !== undefined ? lineStatus(s, where) : null,
    regime: observedRegime(s),
    assessment,
    open: open?.attempt ?? null,
    cooldown: activeCooldown(ctx),
    stop: activeStop(ctx),
    size: sized?.size ?? null,
    sizeProblem: sized?.problem ?? null,
  };
  const notes = [...practiceWhy];
  if (s.lock?.mode === 'live' && !liveTradingOn(ctx.profile)) notes.push(LIVE_OFF_NEXT_LINE);
  const event = s.plan?.event
    ? `${s.plan.event.name} ${nyClockText(eventInstant(ctx.candle, s.plan.event.time))}`
    : null;
  const say = (
    code: StatusCode,
    reason: string,
    next: string,
    title = TITLE[code],
  ): TradeStatus => ({
    code,
    title,
    reason,
    next,
    tone: TONE[code] ?? 'wait',
    basis: BASIS[code],
    practice,
    banner: practice ? TITLE.PRACTICE_ONLY : null,
    event,
    notes,
    facts,
  });

  if (ctx.unreadable)
    return say(
      'LOAD_FAILED',
      "The day's trading session cannot be read.",
      'Restore a backup, or review the day as it is.',
    );
  if (open && open.session !== s)
    return say(
      'RECONCILE_POSITION',
      `A ${open.attempt.side} from the ${displayDate(open.session.date)} candle has no outcome.`,
      'Record how it ended, or Closed in broker earlier.',
    );
  // The flat-by time holds in a live session, as the live windows do; practice skips both. A
  // session started live keeps both to the end of its candle, whatever makes it practice later
  // (a pause in Programs): an open trade there is real at the broker.
  const liveRules = !practice || s.lock?.mode === 'live';
  const flat = liveRules ? flatByPhase(ctx.profile, ctx.candle, ctx.now) : null;
  if (open) {
    if (facts.stop) notes.push('The session has ended: no new entry after this trade.');
    const a = open.attempt;
    const position = `${a.side === 'long' ? 'Long' : 'Short'} ${a.contracts} × ${a.accounts} from ${priceText(a.entry)}, stop ${a.stop === null ? 'not set' : priceText(a.stop)}.`;
    if (flat?.phase === 'past')
      return say(
        'IN_POSITION',
        `${position} Your flat-by time, ${flat.text}, has passed.`,
        "Record how it ended: your firm's rules may have closed it at the broker.",
        `PAST FLAT BY ${flat.text.toUpperCase()} — RECORD THE OUTCOME`,
      );
    if (flat?.phase === 'soon')
      return say(
        'IN_POSITION',
        position,
        `Be flat by ${flat.text}. Record the outcome when it ends.`,
        `IN POSITION — FLAT BY ${flat.text.toUpperCase()}`,
      );
    return say('IN_POSITION', position, 'Honor the stop. Record the outcome when it ends.');
  }
  if (flat?.phase === 'soon') notes.push(`Flat by ${flat.text}.`);
  if (facts.stop)
    return say(
      'SESSION_STOPPED',
      stopLine(facts.stop),
      'A no-trade day is fine. Review when ready.',
    );
  if (exposureUnknown(ctx))
    return say(
      'UNKNOWN_EXPOSURE',
      'A trade has no known loss. Unknown is never counted as zero.',
      'Report the loss.',
    );
  if (facts.cooldown)
    return say('COOLDOWN', cooldownLine(facts.cooldown), 'Stand up, drink water, no charts.');
  if (!s.lock && ctx.unreviewed)
    return say(
      'REVIEW_FIRST',
      `The session of ${displayDate(ctx.unreviewed)} has no review yet.`,
      'Review it; a new session starts once it has one.',
    );
  if (s.bias === 'unclear')
    return say(
      'NO_BIAS',
      'If I cannot explain the expected HTF move: no trade.',
      'A no-trade day is fine.',
    );
  if (!s.lock) {
    const problems = planProblems(ctx);
    if (problems.length) return say('NO_PLAN', problems.join(' '), 'Finish Preparation.');
    return say(
      'NOT_STARTED',
      'The plan is ready.',
      "Tap I'm ready when calm, with the loss accepted.",
    );
  }
  if (flat?.phase === 'past')
    return say(
      'OUTSIDE_WINDOW',
      `No new entries after your flat-by time, ${flat.text}, on this candle.`,
      'The next live window opens at 6 PM New York.',
      `NO ENTRY — PAST FLAT BY ${flat.text.toUpperCase()}`,
    );
  if (liveRules && !liveWindow(ctx.now))
    return say(
      'OUTSIDE_WINDOW',
      'Live entries only in the 6 PM and 9:30 AM windows.',
      'Wait for the window.',
    );
  if (facts.regime?.kind === 'range')
    return say(
      'REGIME_RANGE',
      'The market is ranging. The bias does not override it.',
      'Wait. A no-trade day is fine.',
    );
  if (!thesis || final) {
    const next = 'Only a genuinely new area can start a new thesis.';
    if (status === 'exhausted') {
      const failures = thesis ? thesisAttempts(s, thesis.id).filter(failedAttempt).length : 0;
      if (failures >= 2) notes.push(RANGE_NOTE);
      // Why it was exhausted, as logged: two failures, the one attempt allowed, or the budget.
      const why = thesis!.statusLog.at(-1)!.reason ?? 'Two failed attempts';
      return say(
        'THESIS_EXHAUSTED',
        `${why}. This idea is retired. Do not re-enter the same setup.`,
        next,
      );
    }
    if (status === 'completed')
      return say(
        'THESIS_COMPLETED',
        'The objective was reached.',
        'A later trade needs a new thesis. ' + next,
      );
    if (status === 'invalidated')
      return say('THESIS_INVALIDATED', 'The structure invalidated this idea.', next);
    return say('NO_THESIS', 'The thesis was retired.', next);
  }
  if (facts.line && (facts.line.status === 'baiting' || facts.line.status === 'invalidated')) {
    notes.push(CHART_LINE);
    return say(
      'LINE_BLOCKED',
      `${facts.line.label}: ${LINE_WORDS[facts.line.status].line}`,
      'Retire this thesis. A new one needs another area.',
      facts.line.status === 'invalidated' ? 'NO ENTRY — LINE INVALIDATED' : TITLE.LINE_BLOCKED,
    );
  }
  if (facts.line?.status === 'warning')
    notes.push(`${facts.line.label}: ${LINE_WORDS.warning.line}`);
  if (status === 'reset') {
    notes.push(CHART_LINE);
    return say(
      'RESET_ANSWER',
      'A stop-out does not authorize another entry.',
      'Still valid, or retire it.',
    );
  }
  if (status === 'second-eligible' && !assessment)
    return say(
      'SECOND_ATTEMPT_WAIT',
      'Attempt 2 needs a new qualified setup.',
      'Wait for a new setup at the area.',
    );
  if (!facts.planCurrent)
    return say(
      'PLAN_RECONFIRM',
      `Plan from the ${s.plan!.lock === 'evening' ? '6 PM' : s.plan!.lock === 'morning' ? '9:30 AM' : 'earlier'} GEX — still valid now?`,
      'Confirm the plan with one tap.',
    );
  if (assessment?.zone === 'left')
    return say(
      'MISSED',
      'Price left the area without an entry.',
      'Do not chase. Wait for price to come back.',
    );
  if (assessment?.zone !== 'at') {
    const conditional = thesis.origin === 'plan' && s.plan?.conditional;
    return say(
      'WAITING_ZONE',
      conditional
        ? `Conditional plan: wait for the move into ${whereText(thesis.where)}.`
        : `Price is not at ${whereText(thesis.where)}.`,
      'Wait for price to reach the area. Never chase.',
    );
  }
  const reading = readingProblem(assessment, ctx);
  if (reading) return say(reading.code, reading.reason, reading.next);
  if (sized?.problem && (sized.problem.kind === 'no-entry' || sized.problem.kind === 'no-stop')) {
    // The title says what is missing: the stop above all (no stop, no trade), else the entry.
    const noStop = assessment.stop === null;
    return say(
      'RISK_NEEDED',
      noStop && assessment.entry === null
        ? 'No entry or structural stop yet.'
        : noStop
          ? 'No structural stop, no trade: enter the stop.'
          : 'Enter the entry price.',
      'Enter the entry and the structural stop.',
      noStop ? TITLE.RISK_NEEDED : 'NO ENTRY — NO ENTRY PRICE',
    );
  }
  if (sized?.problem)
    return say(
      'RISK_BLOCKED',
      sized.problem.text,
      'No entry.',
      `NO ENTRY — ${sized.problem.title}`,
    );
  if (thesis.exception)
    notes.push('EXCEPTION — against the bias, with your written justification.');
  notes.push(APP_LEVEL_LINE);
  return say(
    'CHECKS_COMPLETE',
    'Your own read. Life OS cannot see the market or your broker.',
    'Enter in your broker, then tap I ENTERED.',
  );
}

/**
 * I ENTERED: opens an attempt on the current thesis, only while the status is SETUP CHECKS
 * COMPLETE, with the size the stop allows and the reading it was named in. Never a third attempt
 * on one thesis; a skipped or missed setup never uses one.
 */
export function enterAttempt(state: State, routineId: string, at: string): State {
  return changeSession(state, routineId, at, (ctx) => {
    const st = tradeStatus(ctx);
    if (st.code !== 'CHECKS_COMPLETE') throw new Error(`${st.title}. ${st.reason}`);
    const s = ctx.session;
    const t = st.facts.thesis!;
    const limits = st.facts.limits!;
    if (thesisAttempts(s, t.id).length >= limits.attemptsPerThesis)
      throw new Error('No third attempt: this thesis has had its attempts.');
    const a = st.facts.assessment!;
    const size = st.facts.size!;
    const openedAt = notBefore(at, a.at);
    const attempt: Attempt = {
      id: `a${(s.attempts?.length ?? 0) + 1}`,
      thesisId: t.id,
      assessmentId: a.id,
      openedAt,
      side: t.direction,
      entry: a.entry!,
      stop: a.stop!,
      contracts: size.contracts,
      accounts: size.accounts,
      plannedRisk: size.riskTotal,
      costsIncluded: size.costsIncluded,
      practice: st.practice,
    };
    const thesis = moveThesis(moveThesis(t, 'qualified', openedAt), 'active', openedAt);
    // The entry that reaches the session's entry cap ends the session after it.
    return checkStops(
      logged(
        withThesis({ ...s, attempts: append(s.attempts, attempt) }, thesis),
        openedAt,
        'attempt',
        `${attempt.id} ${attempt.side} ${priceText(attempt.entry)}`,
      ),
      ctx.profile,
      openedAt,
    );
  });
}

/** The most refused taps kept on a session; the oldest are dropped past it. */
const MAX_REFUSALS = 200;

/**
 * An I ENTERED tap the status refused (it was not SETUP CHECKS COMPLETE when tapped, say a
 * cooldown or a window that began a moment before): kept on the session with the status that
 * held, for the review. Nothing else changes; a tap the status allows, or one on a reviewed day,
 * records nothing. Kept in its own optional list (`refusals`), which an earlier build ignores and
 * keeps, rather than as a new kind in the session log, which an earlier build would refuse.
 */
export function refuseEntry(state: State, routineId: string, at: string): State {
  return changeSession(state, routineId, at, (ctx) => {
    const s = ctx.session;
    if (ctx.reviewed) return s;
    const st = tradeStatus(ctx);
    if (st.code === 'CHECKS_COMPLETE') return s;
    const refusal = { at: notBefore(at, s.refusals?.at(-1)?.at), status: st.code };
    return { ...s, refusals: [...(s.refusals ?? []).slice(-(MAX_REFUSALS - 1)), refusal] };
  });
}

/** An entry actually taken outside the cockpit, as reported, with its stop when there was one. */
export type TakenDraft = {
  side: 'long' | 'short';
  entry: number;
  stop: number | null;
  /** Per account. */
  contracts: number;
};

/**
 * Log an entry I took: an execution the cockpit did not open is recorded as taken now, so none
 * disappears. It keeps the status that stands now and the stop holding now, counts its planned
 * risk across accounts (with the estimated costs when set) toward the session, or an unknown
 * exposure without a stop or without the instrument to count it, and points to its violations in
 * the review. While a thesis is being worked a trade on its side counts as one of that thesis's
 * attempts (never qualified: the thesis goes straight to active), so its attempts, its exhaustion
 * and its line's failures include it; a third execution is still refused on I ENTERED. A trade on
 * the other side belongs to no thesis. It needs no started session.
 */
export function logTakenAttempt(
  state: State,
  routineId: string,
  draft: TakenDraft,
  at: string,
): State {
  return changeSession(state, routineId, at, (ctx) => {
    notReviewed(ctx);
    const s = ctx.session;
    if (openAttempt(ctx)) throw new Error('Record how the open trade ended first.');
    const limits = liveLimits(s, ctx.profile);
    const tick = limits?.tick ?? ctx.profile.instrument?.tick ?? null;
    const price =
      priceProblem(draft.entry, 'the entry', tick) ??
      (draft.stop !== null ? priceProblem(draft.stop, 'the stop', tick) : null);
    if (price) throw new Error(price);
    if (
      draft.stop !== null &&
      (draft.side === 'long' ? draft.stop >= draft.entry : draft.stop <= draft.entry)
    )
      throw new Error('The stop is on the wrong side of the entry.');
    if (
      !Number.isInteger(draft.contracts) ||
      draft.contracts < 1 ||
      draft.contracts > MAX_CONTRACTS
    )
      throw new Error(`Enter contracts as a whole number from 1 to ${MAX_CONTRACTS}.`);
    const openedAt = notBefore(at, s.attempts?.at(-1)?.openedAt);
    const accounts = limits?.accounts ?? accountsOf(ctx.profile);
    const point = limits?.pointValue ?? ctx.profile.instrument?.pointValue ?? null;
    const commission = limits ? limits.commission : (ctx.profile.costs?.commission ?? null);
    const slippage = limits ? limits.slippageTicks : (ctx.profile.costs?.slippageTicks ?? null);
    const risk =
      draft.stop !== null && point !== null && tick !== null
        ? (contractRiskCents(
            { tick, pointValue: point, commission, slippageTicks: slippage },
            draft.entry,
            draft.stop,
          ) *
            draft.contracts *
            accounts) /
          100
        : null;
    const st = tradeStatus(ctx);
    // Under an I FEEL RUSHED cooldown alone, the status beneath it is kept too: the review judges
    // the trade by it, so only a loss cooldown, a reset or a retired idea makes it a revenge one.
    const rushed =
      st.code === 'COOLDOWN' && runningCooldowns(ctx).every((c) => c.kind === 'rushed');
    const calm = (x: TradingSession | null) =>
      x && { ...x, cooldowns: x.cooldowns?.filter((c) => c.kind !== 'rushed') };
    const under = rushed
      ? tradeStatus({ ...ctx, session: calm(s)!, previous: calm(ctx.previous) }).code
      : null;
    // Only a trade on the thesis's side is one of its attempts; one on the other side is not.
    const worked = s.lock ? currentThesis(s) : null;
    const thesis =
      worked && !FINAL_STATUSES.includes(thesisStatus(worked)) && worked.direction === draft.side
        ? worked
        : null;
    const attempt: Attempt = {
      id: `a${(s.attempts?.length ?? 0) + 1}`,
      thesisId: thesis?.id ?? null,
      assessmentId: null,
      openedAt,
      side: draft.side,
      entry: draft.entry,
      // The stop given is kept even when its risk cannot be counted (no instrument set yet).
      stop: draft.stop,
      contracts: draft.contracts,
      accounts,
      plannedRisk: risk,
      costsIncluded: commission !== null && slippage !== null,
      practice: practiceReasons(ctx).length > 0,
      taken: {
        status: st.code,
        ...(under && { under }),
        ...(st.facts.stop && { stop: st.facts.stop.reason }),
      },
    };
    const code = st.code;
    let next: TradingSession = { ...s, attempts: append(s.attempts, attempt) };
    // A waiting or eligible thesis goes active; one in its reset stays there, its attempt used.
    if (thesis && ['waiting', 'second-eligible'].includes(thesisStatus(thesis)))
      next = withThesis(next, moveThesis(thesis, 'active', openedAt, 'Taken outside the cockpit'));
    next = logged(next, at, 'taken', code);
    // Taken while the status held entries, or above the risk per trade (or with that risk not
    // known, never counted as zero): the session ends at once, beside the violations it points to.
    return takenOutsideChecks(code, risk, accounts, limits)
      ? hardStop(next, 'logged-trade', at)
      : checkStops(next, ctx.profile, at);
  });
}

// The review, pre-filled from the records. Each fact is derived, never answered: it shows as
// Recorded, and a hard violation it points to cannot be unticked (`violationsFromLog`).

export type ReviewFactKey =
  | 'with-plan'
  | 'regime'
  | 'named-first'
  | 'at-area'
  | 'stop'
  | 'restrictions'
  | 'ended'
  | 'within-limits';

export type ReviewFact = {
  key: ReviewFactKey;
  label: string;
  /** Null when there is nothing to judge (no trade). */
  value: boolean | null;
  source: 'recorded';
};

export type ReviewCounts = {
  theses: number;
  attempts: number;
  failed: number;
  exceptions: number;
  /** Lines marked baiting by hand, and lines that reached two failures. */
  baiting: number;
  invalidatedLines: number;
  /** Trades logged after the fact, outside the cockpit. */
  taken: number;
  /** I ENTERED taps refused by the status. */
  refused: number;
};

/**
 * What the records say about a session, for the review: each fact Recorded (derived from
 * timestamps and records), never a self-report; planned and reported amounts are never verified.
 */
export function reviewFacts(s: TradingSession): { facts: ReviewFact[]; counts: ReviewCounts } {
  const attempts = s.attempts ?? [];
  const none = !attempts.length;
  const thesisOf = (a: Attempt) => s.theses?.find((t) => t.id === a.thesisId);
  const readingOf = (a: Attempt) => s.assessments?.find((r) => r.id === a.assessmentId);
  const biasSide = directional(s.bias) ? sideOf(s.bias) : null;
  const regimeAt = (at: string) => (s.observed ?? []).filter((r) => r.at <= at).at(-1);
  const all = (test: (a: Attempt) => boolean) => (none ? null : attempts.every(test));
  const limits = s.lock?.limits;
  const fact = (key: ReviewFactKey, label: string, value: boolean | null): ReviewFact => ({
    key,
    label,
    value,
    source: 'recorded',
  });
  const lines = new Set((s.theses ?? []).map((t) => lineKey(t.where)));
  const marks = s.lines ?? [];
  return {
    facts: [
      fact(
        'with-plan',
        'Every trade on the HTF side (or a recorded exception)',
        all((a) => a.side === biasSide || !!thesisOf(a)?.exception),
      ),
      fact(
        'regime',
        'No trade while the regime read Range / chop',
        all((a) => regimeAt(a.openedAt)?.kind !== 'range'),
      ),
      fact(
        'named-first',
        'Every trade named its setup before the entry',
        all((a) => {
          const r = readingOf(a);
          return !!r?.setup && r.at <= a.openedAt;
        }),
      ),
      fact(
        'at-area',
        'Every trade at the planned area',
        all((a) => readingOf(a)?.zone === 'at'),
      ),
      fact(
        'stop',
        'Every trade had a structural stop',
        all((a) => a.stop !== null),
      ),
      fact(
        'restrictions',
        'No trade taken outside the cockpit',
        all((a) => !a.taken),
      ),
      fact('ended', 'The session was ended or stopped', s.lock ? !!s.sessionStop : null),
      fact(
        'within-limits',
        'Planned risk within the limits (planned, not broker-verified)',
        none || !limits
          ? null
          : attempts.every(
              (a) =>
                a.plannedRisk !== null &&
                a.plannedRisk <= Math.max(limits.tradeRisk, 0) * limits.accounts + 1e-9,
            ),
      ),
    ],
    counts: {
      theses: s.theses?.length ?? 0,
      attempts: attempts.length,
      failed: attempts.filter(failedAttempt).length,
      exceptions: (s.theses ?? []).filter((t) => t.exception).length,
      baiting:
        [...lines].filter((l) => lineStatus(s, l).status === 'baiting').length +
        marks.filter((m) => m.kind === 'baiting' && !lines.has(m.label)).length,
      invalidatedLines: marks.filter((m) => m.kind === 'invalidated').length,
      taken: attempts.filter((a) => a.taken).length,
      refused: s.refusals?.length ?? 0,
    },
  };
}

/**
 * The discipline answers a live session's records give, for the review to pre-fill as Recorded:
 * trades on the HTF side (`with-plan`) and setups named before the entry (`named-first`). The
 * rest are only the trader's to answer. Null without an attempt (the records of a day without a
 * trade are read as before).
 */
export function liveDiscipline(s: TradingSession): DisciplineDraft | null {
  if (!s.attempts?.length) return null;
  const { facts } = reviewFacts(s);
  const value = (key: ReviewFactKey) => facts.find((f) => f.key === key)!.value;
  return {
    labeled: null,
    distinguished: null,
    withBias: value('with-plan'),
    namedSetups: value('named-first'),
    noPrediction: null,
    followedPlan: null,
  };
}

/** "9:42 AM · manual": when the regime chip was set, so it is never mistaken for detection. */
export function regimeStamp(r: ObservedRegime): string {
  return `${nyClockText(Date.parse(r.at))} · manual`;
}
