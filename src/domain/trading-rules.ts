import { DisciplineKey, RegimeKind, SetupId, TradingProfile } from './model';
import { MAX_VIOLATIONS } from './records';

// The app's built-in daily trading rules, shown on the bias board, on the cockpit and in the demo
// rulebook. They are reference text, not advice, and name no account, instrument or amount.

/** The core rules, accepted with every plan. */
export const CORE_RULES = [
  'HTF candle + HTF GEX create the thesis',
  'HTF chooses direction',
  'Wait for your zone',
  'LTF only chooses entry',
  'No entry = leave it',
  'Do not chase',
  'One good entry > constant participation',
  'Stop predicting every LTF candle',
  'Stay with the HTF thesis',
  'Objective or invalidation',
  'If nothing is there, do nothing',
  'Chop = leave it',
];

/** What "Chop = leave it" means, for where the core rule is explained. */
export const CHOP_RULE = 'If structure turns rotational and my zone or setup is gone, I leave it.';

/** Shown with the entry counter and in Your limits: what counts toward the entry limit. */
export const ENTRY_COUNT_RULE =
  'Every order that increases exposure counts as an entry, including an add or a re-entry.';

/** The only profit rule on the live screens: a dollar figure is never a quota. */
export const PROFIT_TARGET_RULE = 'Never take an extra trade to reach a profit target.';

/** How long live trading stays paused after the account set is lost. */
export const ACCOUNT_SET_PAUSE_DAYS = 30;

/** The program-level rule for a lost account set, shown in Programs, Risk rules and on Trading. */
export const ACCOUNT_SET_RULE = `If this account set is lost, live trading is paused for ${ACCOUNT_SET_PAUSE_DAYS} days.`;

/** Risk principles the daily rules do not repeat. */
export const RISK_PRINCIPLES = [
  ENTRY_COUNT_RULE,
  'Adds stay inside risk limits set independently, in advance.',
  PROFIT_TARGET_RULE,
  ACCOUNT_SET_RULE,
];

export type TradingRule = { n: number; title: string; lines: string[] };

/** The fifteen daily trading rules, each with its full text. */
export const DAILY_RULES: TradingRule[] = [
  {
    n: 1,
    title: 'Start with the HTF candle',
    lines: [
      'Before looking for an entry: what do I expect the higher-timeframe candle to do? LONG, SHORT or UNCLEAR.',
      'I must have a clear expectation for where the HTF candle is trying to deliver.',
      'If I cannot explain the expected HTF move: NO TRADE.',
    ],
  },
  {
    n: 2,
    title: 'Confirm the idea with HTF GEX',
    lines: [
      'The directional thesis needs a GEX reason: what GEX level or structure supports this move?',
      'Call Wall, Put Wall, Gamma Flip, Vol Trigger, Focus level, a major GEX range, or the interaction between multiple GEX levels.',
      '“I expect price to move ___ because of ___, toward ___.”',
      'If GEX and HTF structure conflict significantly: WAIT.',
    ],
  },
  {
    n: 3,
    title: 'Define the HTF objective',
    lines: [
      'Where is this HTF candle trying to go? A real market level: a GEX level, HTF high, HTF low, range boundary, major liquidity, previous candle extreme or important structural level.',
      'This is the destination for the thesis. I stay with the thesis until OBJECTIVE HIT or THESIS INVALIDATED.',
      'Not because a small candle scared me.',
    ],
  },
  {
    n: 4,
    title: 'Define the entry zone before price gets there',
    lines: [
      'Use the long/short position tool to map the expected move. The risk (red) portion is where I actually want to enter.',
      'Longs: buy inside the lower/red portion of the projected move. Shorts: sell inside the upper/risk portion.',
      'The entry zone is decided from HTF structure. It is NOT created after I start watching the LTF.',
      'WAIT FOR PRICE TO COME TO ME. If price leaves without entering my zone: LET IT GO.',
      'A correct directional prediction does not automatically mean I had a trade.',
    ],
  },
  {
    n: 5,
    title: 'One direction from the HTF thesis',
    lines: [
      'LONG HTF THESIS = LOOK FOR LONGS. SHORT HTF THESIS = LOOK FOR SHORTS.',
      'Do not constantly flip direction because of lower-timeframe movement. A bearish 15-second candle does not invalidate a bullish HTF thesis, and a bullish one does not invalidate a bearish thesis.',
      'The thesis changes only because something meaningful changes on the higher timeframe.',
    ],
  },
  {
    n: 6,
    title: 'LTF has one job',
    lines: [
      'Is price giving me permission to enter from my predetermined zone?',
      'Sweep + reclaim, displacement, CISD, rejection, structure shift, break and retest, a strong reaction from the zone, or another clearly defined confirmation.',
      'The LTF does NOT determine my overall directional bias. It only chooses the entry.',
    ],
  },
  {
    n: 7,
    title: 'Entry requires a named setup and every confirmation',
    lines: [
      'Before clicking: With the daily bias? A named setup on the 5m or 15m chart? Inside the planned GEX area? Current GEX supports the HTF direction and objective? LTF confirmation? Not chasing? Clear invalidation and a stop inside my risk limits?',
      'If any answer is NO: NO ENTRY.',
    ],
  },
  {
    n: 8,
    title: 'No chasing',
    lines: [
      'If price leaves the entry zone without giving the setup: MISS THE TRADE.',
      'Do not chase into the projected profit area. Do not manufacture a new LTF setup because the original thesis was correct.',
      'RIGHT THESIS + BAD ENTRY = NO TRADE. RIGHT THESIS + NO ENTRY = NO TRADE.',
    ],
  },
  {
    n: 9,
    title: 'After entry, stop re-predicting the market',
    lines: [
      'Once entered: STOP USING THE LTF TO PREDICT EVERY NEXT MOVE.',
      'Return attention to the HTF candle, 15m structure, 5m structure, GEX levels, the original objective and the original invalidation.',
      'Do not let every 5s/15s candle create a new opinion. The important decisions were made BEFORE entry.',
    ],
  },
  {
    n: 10,
    title: 'Stay with the thesis',
    lines: [
      'Stay with the HTF idea until objective or invalidation.',
      'Do not panic because of small pullbacks, exit because of random LTF candles, flip direction, constantly move targets or continuously invent new predictions.',
      'Has something actually changed on the HTF? If NO: THE THESIS REMAINS THE SAME.',
    ],
  },
  {
    n: 11,
    title: 'Fewer entries',
    lines: [
      'The goal is not to constantly participate. The goal is to find the best expression of the HTF thesis: ONE GOOD ENTRY.',
      'After missing an entry, do not create another mediocre one just because you still believe in the direction. Wait for another legitimate location.',
      'If one never appears: LEAVE IT.',
    ],
  },
  {
    n: 12,
    title: 'A stopped idea does not get automatically re-entered',
    lines: [
      'After an entry fails, do not jump back in because the HTF direction still looks right. Return to the HTF: what genuinely changed that gives me a new entry?',
      'A new trade requires a valid HTF thesis still existing, a genuinely new location, new LTF permission and a clear invalidation.',
      'A few new tiny candles are not enough.',
    ],
  },
  {
    n: 13,
    title: 'Adds are planned before the first entry',
    lines: [
      'Any add location must be planned before the first entry. Do not invent an add from LTF movement after entry.',
      'Every add counts as an entry.',
      'Never add simply because “I think it will come back.” Never use adding to rescue a bad entry.',
    ],
  },
  {
    n: 14,
    title: 'Objective hit = thesis complete',
    lines: [
      'Once the original HTF objective is reached: THE TRADE IDEA IS FINISHED.',
      'Do not automatically assume continuation. Zoom out and reassess the current HTF candle, GEX, market structure, the next objective and a new potential entry area.',
      'If a new thesis exists, build it from scratch.',
    ],
  },
  {
    n: 15,
    title: 'Invalidation = thesis complete',
    lines: [
      'If the HTF thesis is invalidated: STOP TRADING THAT THESIS.',
      'Do not immediately reverse simply because the first direction failed.',
      'Rebuild from the top: HTF CANDLE → GEX → DIRECTION → OBJECTIVE → ZONE. Only then can a new trade exist.',
    ],
  },
];

/** Rule 12: what a new trade needs after an entry fails. */
export const NEW_ENTRY_NEEDS = [
  'A valid HTF thesis still exists',
  'A genuinely new location',
  'New LTF permission',
  'A clear invalidation',
];

/** The final checklist's "After I enter". */
export const AFTER_ENTRY = [
  'I stop trying to predict every LTF candle.',
  'I return attention to HTF/5m structure.',
  'I stay with the original thesis.',
  'I only change the plan if HTF information changes.',
];

// The cockpit's built-in wording: the preflight, the named setups and the management reminders.

export type NamedSetup = {
  id: SetupId;
  /** A, B or C, as the setups are shown in order. */
  letter: 'A' | 'B' | 'C';
  name: string;
  /** One short line for a bullish day (longs) and for a bearish day (shorts). */
  long: string;
  short: string;
  /** A further line for both sides, when the setup has one. */
  note?: { long: string; short: string };
};

/**
 * The three named setups, read at the planned GEX area on the 5-minute or 15-minute chart. Each is
 * described for the side the daily bias allows; what counts as a pierce, a sweep or a retake is the
 * user's own read, and no candle-close rule is implied.
 */
export const SETUPS: NamedSetup[] = [
  {
    id: 'pierce-push',
    letter: 'A',
    name: 'Pierce & Push-Away',
    long: 'Price pierces below my GEX level, then pushes away from it to the upside.',
    short: 'Price pierces above my GEX level, then pushes away from it to the downside.',
  },
  {
    id: 'sweep-retake',
    letter: 'B',
    name: 'Delivery, Sweep & Retake',
    long: 'Price is delivered into my GEX area, sweeps the low beneath it, then retakes the level.',
    short:
      'Price is delivered into my GEX area, sweeps the high above it, then retakes the level from above.',
    note: {
      long: 'What counts as the retake is my own read: no candle-close rule is set for it.',
      short: 'What counts as the retake is my own read: no candle-close rule is set for it.',
    },
  },
  {
    id: 'double-pierce',
    letter: 'C',
    name: 'Double Pierce / Reclaim',
    long: 'Price pierces below my GEX level twice and reclaims it after the second pierce.',
    short: 'Price pierces above my GEX level twice and loses it again after the second pierce.',
    note: {
      long: 'Fast variation: one quick break below the level and an immediate reclaim.',
      short:
        'Fast variation: one quick break above the level and an immediate rejection back below.',
    },
  },
];

// The HTF candle classification an earlier build saved: the user's own read of the daily or 4-day
// candle, never a market reading, and never an authorization to trade on its own.

export type RegimeCard = {
  kind: RegimeKind;
  /** The card's title on step 3. */
  title: string;
  /** The header's label: restrained, never a buy or sell signal. */
  label: string;
  lines: string[];
};

export const REGIME_CARDS: RegimeCard[] = [
  {
    kind: 'range',
    title: 'RANGE / SMALLER MOVE',
    label: 'RANGE',
    lines: [
      'Consolidation, overlapping candles, limited delivery.',
      'Expect smaller moves and take the normal objective.',
      "Don't force trades in chop.",
    ],
  },
  {
    kind: 'candidate',
    title: 'EXPANSION CANDIDATE',
    label: 'EXPANSION CANDIDATE',
    lines: [
      'The daily or 4-day context suggests significant delivery, not yet confirmed.',
      'Prepare a normal and a larger objective.',
      'Default to normal profit-taking. Do not assume expansion.',
    ],
  },
  {
    kind: 'confirmed',
    title: 'CONFIRMED EXPANSION',
    label: 'EXPANSION CONFIRMED',
    lines: [
      'Price has shown sustained delivery with the thesis.',
      'Qualified entries only in the HTF direction.',
      'A planned runner may target the larger objective; take most profit at the normal target.',
      'Never increase the initial risk.',
    ],
  },
];

/** The classification card by its kind. */
export function regimeCard(kind: RegimeKind): RegimeCard {
  return REGIME_CARDS.find((c) => c.kind === kind)!;
}

/** The header's label when the day has no classification (never one invented for the past). */
export const NOT_CLASSIFIED = 'NOT CLASSIFIED';

/** The review's six discipline questions, Yes or No, in order. */
export const DISCIPLINE_QUESTIONS: { key: DisciplineKey; text: string }[] = [
  { key: 'labeled', text: 'Labeled the HTF candle environment before trading' },
  { key: 'distinguished', text: 'Distinguished expected expansion from confirmed expansion' },
  { key: 'withBias', text: 'Avoided all trades against my HTF bias' },
  { key: 'namedSetups', text: 'Every trade had a recognizable 5m/15m GEX setup' },
  {
    key: 'noPrediction',
    text: 'Avoided predicting and reacting emotionally to individual candles',
  },
  { key: 'followedPlan', text: 'Followed my planned normal/runner management' },
];

/** Said wherever an answer on the cockpit is a report, never a reading of an account. */
export const OWN_REPORT_LINE =
  'Life OS cannot see your accounts, positions or orders: every answer here is your own report.';

/** The counter-bias hard violation, by its default ID (`hard-14`, never reused). */
export const COUNTER_BIAS_VIOLATION = { id: 'hard-14', title: 'Traded against my daily bias' };

/**
 * The profile with the counter-bias hard violation appended when it lists none under its ID and
 * has room under `MAX_VIOLATIONS`, so a trade against the bias can always be recorded as the
 * serious violation it is. Otherwise the profile as it is. Every default profile already has it.
 */
export function withCounterBiasViolation(profile: TradingProfile): TradingProfile {
  const { id, title } = COUNTER_BIAS_VIOLATION;
  if (profile.violations.some((v) => v.id === id) || profile.violations.length >= MAX_VIOLATIONS)
    return profile;
  return { ...profile, violations: [...profile.violations, { id, title, details: '' }] };
}
