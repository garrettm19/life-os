import { State, StrategyStep, TradingProfile, TradingStrategy } from './model';
import { validateTradingProfile } from './records';
import { saveTradingProfile } from './trading';
import { CisdHow } from './trading-live-model';

// My Trading Strategy: the reference the cockpit links to, kept as editable text on the trading
// profile. It is read, never enforced: what the cockpit allows comes only from typed fields (the
// plan, the setup chips, the prices, the limits). The one exception is a fact, not wording:
// Setup B cannot complete until its retake rule is written here.

/**
 * The template a new profile starts with: five generic steps, each a prompt the trader rewrites in
 * their own words. No method, instrument or amount is suggested.
 */
export const DEFAULT_STRATEGY_STEPS: StrategyStep[] = [
  {
    title: 'Read the higher timeframe',
    summary: 'How you decide the side you favor before the session.',
    detail:
      'Write how you read the higher-timeframe chart: what you look at, what makes a day directional or conditional, and when you have no view and stay out.',
  },
  {
    title: 'Mark your levels',
    summary: 'Which levels you plot, and when they stop counting.',
    detail:
      'Write which levels you mark before the session, where they come from, and when an earlier level must be confirmed again before it is used.',
  },
  {
    title: 'Write the thesis',
    summary: 'Direction or sequence, target, reason and where it is wrong.',
    detail:
      'Write the thesis in one or two lines: the expected direction or sequence, the target, why, and the structure that proves it wrong.',
  },
  {
    title: 'Name your setups',
    summary: 'The only entries you take, and what confirms each.',
    detail:
      'Write each setup you trade, what confirms it and what is never enough on its own. Anything not written here is not a setup.',
  },
  {
    title: 'Risk and management',
    summary: 'Fixed risk, the stop, and when the trade is done.',
    detail:
      'Write your risk per trade, how the stop sets the size, how you manage an open trade and when you are done for the day.',
  },
];

/** The strategy reference a profile starts with: the template, an empty Key, no retake rule. */
export function defaultStrategy(): TradingStrategy {
  return { steps: DEFAULT_STRATEGY_STEPS.map((s) => ({ ...s })), key: '', retakeRule: null };
}

/** The profile's strategy reference, or the generic one until it is first edited. */
export function strategyOf(profile: TradingProfile): TradingStrategy {
  return profile.strategy ?? defaultStrategy();
}

/** Whether Setup B's retake rule is written: until then B cannot complete. */
export function retakeRuleSet(profile: TradingProfile): boolean {
  return !!profile.strategy?.retakeRule?.trim();
}

/**
 * Saves the strategy reference (steps, My Key, Setup B's retake rule), trimmed; a blank retake
 * rule is none. Wording only: nothing the cockpit allows or blocks reads it, except whether the
 * retake rule is written.
 */
export function saveStrategy(
  state: State,
  routineId: string,
  strategy: TradingStrategy,
  at: string,
): State {
  const book = state.ruleBooks.find((b) => b.routineId === routineId);
  if (!book?.trading) throw new Error('Set up Trading discipline first.');
  const rule = strategy.retakeRule?.trim() ?? '';
  const next: TradingProfile = {
    ...book.trading,
    strategy: {
      steps: strategy.steps.map((s) => ({
        title: s.title.trim(),
        summary: s.summary.trim(),
        detail: s.detail.trim(),
      })),
      key: strategy.key.trim(),
      retakeRule: rule || null,
    },
  };
  try {
    validateTradingProfile(next);
  } catch {
    throw new Error('Give every card a title, and keep the wording within its length.');
  }
  return saveTradingProfile(state, routineId, next, at);
}

/** How a CISD can be confirmed, in order, and whether each is enough to complete the setup. */
export const CISD_CHOICES: { id: CisdHow; label: string; enough: boolean }[] = [
  { id: 'range', label: 'Range around CISD', enough: true },
  { id: 'body', label: 'Body in CISD', enough: true },
  { id: 'double-tap', label: 'Double tap', enough: true },
  { id: 'single-wick', label: 'Single wick — not enough', enough: false },
];

/** The CISD rule as the setup control says it. */
export const CISD_RULE =
  'A single wick or tap is not enough: price ranges around the CISD, a body establishes in it, or it is tapped twice.';

/** Shown on Setup B until its retake rule is written. */
export const RETAKE_RULE_MISSING = "Write Setup B's retake rule in My Trading Strategy first.";
