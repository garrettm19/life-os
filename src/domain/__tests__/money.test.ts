import { describe, expect, it } from '@jest/globals';
import { encodeBackup, parseBackup } from '../backup';
import { decodeState } from '../data';
import { MoneyReview, State } from '../model';
import {
  changeTone,
  currentPriority,
  fieldChanges,
  lastReported,
  saveMoneyReview,
  setPriorityDone,
} from '../money';
import { moneySince } from '../series';
import { trainingState } from '../../test-support/fixtures';

// Synthetic balances only.
const base = {
  currency: 'USD',
  cash: null,
  savings: null,
  debt: null,
  upcoming: null,
  contributed: null,
  savingsTarget: null,
  nextAction: '',
  note: '',
  goalId: null,
};
const stamp = (date: string, hour = 18) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
};
function review(state: State, id: string, date: string, figures: Partial<MoneyReview>, hour = 18) {
  return saveMoneyReview(state, { ...base, ...figures, date }, id, stamp(date, hour));
}
const OCT25 = '2026-10-25';
const NOV1 = '2026-11-01';
const NOV8 = '2026-11-08';

describe('money changes since the last report', () => {
  it('compare each figure with the review that last reported it, not just the previous one', () => {
    let state = review(trainingState(), 'a', OCT25, { cash: 90000, savings: 200000, debt: 500000 });
    // Nov 1 left debt blank.
    state = review(state, 'b', NOV1, { cash: 80000, savings: 250000 });
    state = review(state, 'c', NOV8, { cash: 80000, savings: 240000, debt: 470000 });
    const latest = state.moneyReviews.find((r) => r.id === 'c')!;
    const [cash, savings, debt] = fieldChanges(state, latest);
    expect(debt).toMatchObject({ delta: -30000, previous: { value: 500000, date: OCT25 } });
    expect(savings).toMatchObject({ delta: -10000, previous: { value: 250000, date: NOV1 } });
    expect(cash).toMatchObject({ value: 80000, delta: 0, previous: { value: 80000, date: NOV1 } });
    // Since the first report.
    expect(savings).toMatchObject({ sinceFirst: 40000, first: { date: OCT25 } });
    expect(changeTone('debt', debt.delta)).toBe('good');
    expect(changeTone('savings', savings.delta)).toBe('watch');
    expect(changeTone('cash', -5)).toBe('neutral');
  });

  it('say what was not reported and what is a first report, never assuming zero', () => {
    let state = review(trainingState(), 'a', OCT25, { savings: 200000 });
    state = review(state, 'b', NOV1, { debt: 300000 });
    const [cash, , debt] = fieldChanges(
      state,
      state.moneyReviews.find((r) => r.id === 'b')!,
    );
    expect(cash).toMatchObject({ value: null, delta: null });
    expect(debt).toMatchObject({ value: 300000, previous: null, delta: null, sinceFirst: null });
  });

  it('never compare across currencies, and a correction on the same date stands for that date', () => {
    let state = review(trainingState(), 'eur', OCT25, { savings: 100000, currency: 'EUR' });
    state = review(state, 'a', NOV1, { savings: 120000 }, 9);
    expect(lastReported(state, 'savings', 'USD', { date: NOV8, at: stamp(NOV8) })!.value).toBe(
      120000,
    );
    expect(
      fieldChanges(
        state,
        state.moneyReviews.find((r) => r.id === 'a')!,
      )[1].previous,
    ).toBeNull();
    // A second review later the same day corrects the figure: one trend point, the later value.
    state = review(state, 'b', NOV1, { savings: 125000 }, 20);
    const series = moneySince(state, 'savings', null, NOV8)!;
    expect(series.points).toEqual([{ date: NOV1, y: 125000 }]);
    expect(series.otherCurrency).toBe(1);
  });
});

describe("the week's money priority", () => {
  it('comes from the latest review in the last seven days, and only if it named one', () => {
    let state = review(trainingState(), 'a', NOV1, { cash: 1000, nextAction: 'Call the lender' });
    expect(currentPriority(state, NOV1)!.nextAction).toBe('Call the lender');
    expect(currentPriority(state, '2026-11-07')!.id).toBe('a');
    // A week later it has expired; it is never carried over.
    expect(currentPriority(state, NOV8)).toBeNull();
    // A newer review this week without a priority means none.
    state = review(state, 'b', '2026-11-03', { cash: 900 });
    expect(currentPriority(state, '2026-11-04')).toBeNull();
  });

  it('can be marked done and reopened; a changed priority starts open again', () => {
    let state = review(trainingState(), 'a', NOV1, { cash: 1000, nextAction: 'Call the lender' });
    state = setPriorityDone(state, 'a', stamp('2026-11-03'));
    expect(currentPriority(state, '2026-11-03')!.priorityDoneAt).toBe(stamp('2026-11-03'));
    // Correcting the figures keeps it done.
    state = saveMoneyReview(
      state,
      { ...base, id: 'a', date: NOV1, cash: 1100, nextAction: 'Call the lender' },
      'x',
      stamp(NOV1, 20),
    );
    expect(state.moneyReviews[0].priorityDoneAt).toBe(stamp('2026-11-03'));
    // New words, a new priority.
    state = saveMoneyReview(
      state,
      { ...base, id: 'a', date: NOV1, cash: 1100, nextAction: 'Cancel one subscription' },
      'x',
      stamp(NOV1, 21),
    );
    expect(state.moneyReviews[0].priorityDoneAt).toBeUndefined();
    state = setPriorityDone(setPriorityDone(state, 'a', stamp(NOV1, 22)), 'a', null);
    expect(state.moneyReviews[0].priorityDoneAt).toBeNull();
    expect(() => setPriorityDone(review(state, 'b', NOV8, { cash: 1 }), 'b', stamp(NOV8))).toThrow(
      'no longer exists',
    );
  });

  it('survives a backup and refuses a malformed done time', () => {
    const state = setPriorityDone(
      review(trainingState(), 'a', NOV1, { cash: 1000, nextAction: 'Call the lender' }),
      'a',
      stamp('2026-11-02'),
    );
    expect(parseBackup(encodeBackup(state)).state.moneyReviews[0].priorityDoneAt).toBe(
      stamp('2026-11-02'),
    );
    expect(() =>
      decodeState({
        ...state,
        moneyReviews: [{ ...state.moneyReviews[0], priorityDoneAt: 'tuesday' }],
      }),
    ).toThrow('priority');
  });
});
