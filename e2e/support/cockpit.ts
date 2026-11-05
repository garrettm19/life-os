import { expect, type Page } from '@playwright/test';
import type { State, TradingProfile } from '../../src/domain/model';
import {
  AssessmentChange,
  PlanDraft,
  assess,
  lockSession,
  recordExit,
  savePlan,
} from '../../src/domain/trading-live';
import { enterAttempt } from '../../src/domain/trading-status';
import { seed } from './storage';
import { TRADING_ROUTINE, tradingState } from './trading-state';

// The trading cockpit in the browser suite: a profile with example limits on an example
// instrument (labelled as such, never anyone's real account), sessions built with the app's own
// rules (src/domain/trading-live.ts), and the screens driven as the user would. Prices are
// labelled example prices on no real chart.

/** Example instrument and risk limits, as typed in Your limits. */
export const EXAMPLE_INSTRUMENT = { name: 'Example index (MNQ-like)', pointValue: 2, tick: 0.25 };
export const EXAMPLE_RISK = { tradeRisk: 100, maxContracts: 5, thesisRisk: 150, dailyLoss: 300 };
/** Live trading on, with the money question answered (`liveTradingOn`). */
export const LIVE: Partial<TradingProfile> = { liveTrading: true, moneySetAsideOn: '2026-11-02' };

/** An example bullish plan: target above, invalidation below, at a labelled area. */
export const LONG_PLAN: PlanDraft = {
  bias: 'bullish',
  why: 'Example: price delivers toward the prior day high',
  target: 25100,
  target2: null,
  invalidation: 24980,
  where: 'Example level',
  conditional: false,
  event: null,
};
/** The bearish mirror. */
export const SHORT_PLAN: PlanDraft = {
  bias: 'bearish',
  why: 'Example: price delivers toward the prior day low',
  target: 24900,
  target2: null,
  invalidation: 25020,
  where: 'Example level',
  conditional: false,
  event: null,
};

/** The trading state with the example instrument and risk limits set in Your limits. */
export function cockpitState(
  profile: Partial<TradingProfile> = {},
  since: string | null = '2026-11-02',
): State {
  const state = tradingState(since);
  return {
    ...state,
    ruleBooks: state.ruleBooks.map((b) =>
      b.routineId === TRADING_ROUTINE && b.trading
        ? {
            ...b,
            trading: {
              ...b.trading,
              instrument: EXAMPLE_INSTRUMENT,
              risk: EXAMPLE_RISK,
              ...profile,
            },
          }
        : b,
    ),
  };
}

export const profileOf = (state: State): TradingProfile =>
  state.ruleBooks.find((b) => b.routineId === TRADING_ROUTINE)!.trading!;

/** Seeds the plan (with any sessions already in it) at `clock`, then opens `route`. */
export async function openCockpit(
  page: Page,
  {
    state = cockpitState(),
    clock,
    route = '/trading',
  }: { state?: State; clock: Date; route?: string },
) {
  await seed(page, state, { clock, route });
}

export { savedSession } from './storage';

// Sessions built with the cockpit's own writes, at the instants given (ISO).

/** The plan saved at `at`. */
export const planned = (state: State, at: string, plan: Partial<PlanDraft> = {}): State =>
  savePlan(state, TRADING_ROUTINE, { ...LONG_PLAN, ...plan }, at);

/** The plan saved at `planAt` and the session started (I'm ready) at `at`. */
export const begun = (
  state: State,
  at: string,
  plan: Partial<PlanDraft> = {},
  planAt = at,
): State => lockSession(planned(state, planAt, plan), TRADING_ROUTINE, at);

/** A complete setup reading at the area: Setup A on the 5m, confirmed, entry and stop. */
export const READY: AssessmentChange = {
  zone: 'at',
  setup: 'pierce-push',
  timeframe: '5m',
  confirmed: true,
  entry: 25040,
  stop: 25030,
};

export const readied = (state: State, at: string, more: AssessmentChange = {}): State =>
  assess(state, TRADING_ROUTINE, { ...READY, ...more }, at);

/** Ready at `readyAt`, then I ENTERED at `at`. */
export const enteredAt = (state: State, readyAt: string, at: string, more: AssessmentChange = {}) =>
  enterAttempt(readied(state, readyAt, more), TRADING_ROUTINE, at);

/** The open attempt ended as `kind` at `at`. */
export const exited = (
  state: State,
  attemptId: string,
  at: string,
  kind: 'objective' | 'stopped' | 'flat' | 'invalidated' | 'reconciled' = 'stopped',
): State => recordExit(state, TRADING_ROUTINE, attemptId, { kind }, at);

// Driving the screens.

/** The status band, always on screen above the cockpit. */
export const status = (page: Page) => page.getByTestId('trade-status');
export const statusTitle = (page: Page) => page.getByTestId('trade-status-title');

/** The status title reads `title` (its symbol sits beside it). */
export async function expectStatus(page: Page, title: string | RegExp) {
  await expect(statusTitle(page)).toHaveText(
    typeof title === 'string' ? new RegExp(`^${escape(title)}$`) : title,
  );
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Matches an accessible name that says `text`: the thesis strip shows its figures as a scoreboard
 * and says them as one sentence, which these tests read.
 */
export const saying = (text: string) => new RegExp(escape(text));

/** I FEEL RUSHED, always in the page's footer. */
export const rushed = (page: Page) => page.getByTestId('i-feel-rushed');

/** Preparation's plan typed and saved as the user would. */
export async function typePlan(page: Page, plan: Partial<PlanDraft> = {}) {
  const p = { ...LONG_PLAN, ...plan };
  await page.getByRole('radio', { name: `HTF ${p.bias}`, exact: true }).click();
  if (p.conditional) await page.getByRole('radio', { name: /^A move into my area first/ }).click();
  await page.getByLabel('Why · one line', { exact: true }).fill(p.why);
  await page.getByLabel('Target', { exact: true }).fill(String(p.target));
  await page.getByLabel('Invalidation', { exact: true }).fill(String(p.invalidation));
  if (p.target2 !== null)
    await page.getByLabel('2nd target · optional', { exact: true }).fill(String(p.target2));
  if (p.where) await page.getByLabel('Where · optional', { exact: true }).fill(p.where);
  if (p.event) {
    await page.getByRole('button', { name: 'Add a major event today', exact: true }).click();
    await page.getByLabel('Major event', { exact: true }).fill(p.event.name);
    await page.getByLabel('NY time', { exact: true }).fill(p.event.time);
  }
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
}

/** I'M READY. */
export const imReady = (page: Page) =>
  page.getByRole('button', { name: /^I'm ready: calm, the loss accepted/ }).click();

/** At the area, a named setup on its chart, confirmed: the taps of a live setup. */
export async function tapSetup(
  page: Page,
  { setup = /^Setup A:/, chart = '5 minute chart' }: { setup?: RegExp; chart?: string } = {},
) {
  await page.getByRole('radio', { name: 'Price at my area', exact: true }).click();
  await page.getByRole('radio', { name: setup }).click();
  await page.getByRole('radio', { name: chart, exact: true }).click();
  await page.getByRole('checkbox', { name: 'Setup confirmed', exact: true }).click();
}

/** The entry and the stop, in their one sheet. */
export async function typeRisk(page: Page, entry: number, stop: number) {
  await page.getByRole('button', { name: 'Enter the entry and the structural stop' }).click();
  await page.getByLabel('Entry', { exact: true }).fill(String(entry));
  await page.getByLabel('Stop', { exact: true }).fill(String(stop));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}

/** I ENTERED, once the checks are complete. */
export const iEntered = (page: Page) =>
  page.getByRole('button', { name: 'I entered in my broker', exact: true }).click();

/** The review: every item PASS (or FAIL) and every discipline question still open answered. */
export async function answerReview(
  page: Page,
  items: 'pass' | 'fail' = 'pass',
  discipline: 'yes' | 'no' = 'yes',
) {
  for (const radio of await page.getByRole('radio', { name: new RegExp(`: ${items}$`) }).all())
    await radio.click();
  for (const radio of await page.getByRole('radio', { name: new RegExp(`: ${discipline}$`) }).all())
    if ((await radio.getAttribute('aria-checked')) !== 'true') {
      const other = discipline === 'yes' ? 'no' : 'yes';
      const name = (await radio.getAttribute('aria-label'))!.replace(
        new RegExp(`: ${discipline}$`),
        `: ${other}`,
      );
      // A question already answered (pre-filled from the session) keeps its answer.
      if (
        (await page.getByRole('radio', { name, exact: true }).getAttribute('aria-checked')) !==
        'true'
      )
        await radio.click();
    }
}
