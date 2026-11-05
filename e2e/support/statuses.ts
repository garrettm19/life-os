import type { State } from '../../src/domain/model';
import type { StatusCode } from '../../src/domain/trading-live-model';
import {
  answerReset,
  assess,
  feelRushed,
  markLine,
  recordExit,
  retireThesis,
  setRegime,
  setUnclear,
} from '../../src/domain/trading-live';
import { logTakenAttempt } from '../../src/domain/trading-status';
import { LIVE, begun, cockpitState, enteredAt, exited, planned, readied } from './cockpit';
import { TRADING_ROUTINE } from './trading-state';

// One synthetic state for every status the cockpit can show, built with the app's own writes:
// Monday, November 9, 2026 in New York (standard time, UTC-5), with Friday, November 6 as the
// candle before it. Example prices only.

export const MON = '2026-11-09';
export const FRI = '2026-11-06';
const MIN = 60_000;
/** A New York wall-clock time on Monday (Sunday evening with a negative hour) as an instant. */
export const ny = (h: number, m = 0) =>
  new Date(Date.parse(`${MON}T00:00:00Z`) + ((h + 5) * 60 + m) * MIN);
export const at = (h: number, m = 0) => ny(h, m).toISOString();
/** Friday's New York wall-clock time as an instant. */
export const fri = (h: number, m = 0) =>
  new Date(Date.parse(`${FRI}T00:00:00Z`) + ((h + 5) * 60 + m) * MIN).toISOString();

const R = TRADING_ROUTINE;

export type StatusCase = { state: State; clock: Date };

/** The session started at 9:40 AM Monday, waiting for the zone. */
const live = () => begun(cockpitState(), at(9, 40), {}, at(9, 35));
/** Entered at 9:46 AM, stopped out at 10:00 AM: the loss cooldown ends at 10:25 AM. */
const stoppedOnce = (state = live()) =>
  exited(enteredAt(state, at(9, 45), at(9, 46)), 'a1', at(10, 0));

/** Each status code, in the table's order, as a state and the clock to open it at. */
export const STATUS_CASES: Partial<Record<StatusCode, () => StatusCase>> = {
  LOAD_FAILED: () => ({
    state: { ...planned(cockpitState(), at(9, 35)), tradingSessionsUnreadable: { [MON]: '{' } },
    clock: ny(10),
  }),
  RECONCILE_POSITION: () => ({
    state: enteredAt(begun(cockpitState(), fri(9, 40)), fri(9, 45), fri(9, 46)),
    clock: ny(10),
  }),
  IN_POSITION: () => ({ state: enteredAt(live(), at(9, 45), at(9, 46)), clock: ny(9, 50) }),
  // The longest stop line: a trade logged while entries were held ended the session.
  SESSION_STOPPED: () => {
    const taken = logTakenAttempt(
      live(),
      R,
      { side: 'long', entry: 25040, stop: 25030, contracts: 1 },
      at(9, 45),
    );
    return { state: recordExit(taken, R, 'a1', { kind: 'objective' }, at(9, 55)), clock: ny(10) };
  },
  // Friday's trade logged with no stop: its stop ended at 9:30 AM, its exposure still holds.
  UNKNOWN_EXPOSURE: () => {
    const taken = logTakenAttempt(
      begun(cockpitState(), fri(9, 40)),
      R,
      { side: 'long', entry: 25040, stop: null, contracts: 1 },
      fri(9, 45),
    );
    return {
      state: recordExit(taken, R, 'a1', { kind: 'reconciled' }, fri(9, 55)),
      clock: ny(10),
    };
  },
  COOLDOWN: () => ({ state: feelRushed(live(), R, at(9, 55)), clock: ny(10) }),
  REVIEW_FIRST: () => ({ state: begun(cockpitState(), fri(9, 40)), clock: ny(10) }),
  NO_BIAS: () => ({ state: setUnclear(cockpitState(), R, at(9, 0)), clock: ny(10) }),
  NO_PLAN: () => ({ state: cockpitState(), clock: ny(10) }),
  NOT_STARTED: () => ({ state: planned(cockpitState(), at(9, 35)), clock: ny(10) }),
  OUTSIDE_WINDOW: () => ({
    state: begun(cockpitState(LIVE), at(9, 40), {}, at(9, 35)),
    clock: ny(16, 30),
  }),
  REGIME_RANGE: () => ({ state: setRegime(live(), R, 'range', at(9, 50)), clock: ny(10) }),
  // Three losses in a row end this session (two by default), so the thesis's own status shows.
  THESIS_EXHAUSTED: () => {
    const lenient = begun(cockpitState({ maxLossRun: 3 }), at(9, 40), {}, at(9, 35));
    const second = answerReset(stoppedOnce(lenient), R, 't1', true, at(10, 30));
    const again = enteredAt(second, at(10, 31), at(10, 32));
    return { state: exited(again, 'a2', at(10, 40)), clock: ny(11, 10) };
  },
  THESIS_COMPLETED: () => ({
    state: exited(enteredAt(live(), at(9, 45), at(9, 46)), 'a1', at(10, 0), 'objective'),
    clock: ny(10, 5),
  }),
  THESIS_INVALIDATED: () => ({
    state: exited(enteredAt(live(), at(9, 45), at(9, 46)), 'a1', at(10, 0), 'invalidated'),
    clock: ny(10, 30),
  }),
  NO_THESIS: () => ({ state: retireThesis(live(), R, 't1', at(9, 50)), clock: ny(10) }),
  LINE_BLOCKED: () => ({
    state: markLine(live(), R, 'Example level', 'baiting', null, at(9, 50)),
    clock: ny(10),
  }),
  RESET_ANSWER: () => ({ state: stoppedOnce(), clock: ny(10, 30) }),
  SECOND_ATTEMPT_WAIT: () => ({
    state: answerReset(stoppedOnce(), R, 't1', true, at(10, 30)),
    clock: ny(10, 31),
  }),
  PLAN_RECONFIRM: () => ({
    state: begun(cockpitState(), at(-5), {}, at(-5, -10)),
    clock: ny(9, 40),
  }),
  MISSED: () => ({ state: assess(live(), R, { zone: 'left' }, at(9, 50)), clock: ny(10) }),
  WAITING_ZONE: () => ({ state: live(), clock: ny(10) }),
  WAITING_SETUP: () => ({ state: assess(live(), R, { zone: 'at' }, at(9, 50)), clock: ny(10) }),
  SETUP_FORMING: () => ({
    state: assess(live(), R, { zone: 'at', setup: 'pierce-push', timeframe: '5m' }, at(9, 50)),
    clock: ny(10),
  }),
  CONFIRMATION_INCOMPLETE: () => ({
    state: readied(live(), at(9, 50), { cisd: 'single-wick' }),
    clock: ny(10),
  }),
  RISK_NEEDED: () => ({
    state: readied(live(), at(9, 50), { entry: null, stop: null }),
    clock: ny(10),
  }),
  RISK_BLOCKED: () => ({ state: readied(live(), at(9, 50), { stop: 24800 }), clock: ny(10) }),
  CHECKS_COMPLETE: () => ({ state: readied(live(), at(9, 50)), clock: ny(10) }),
};
