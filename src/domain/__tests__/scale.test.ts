import { describe, expect, it } from '@jest/globals';
import { DEMO } from '../demo-catalog';
import { RuleBook, State, shiftDate } from '../model';
import {
  dayClearStreak,
  dayOutcome,
  dayProgress,
  objectiveLeaves,
  streakHistory,
} from '../objectives';
import {
  TradingDay,
  cleanStreak,
  isTradingReview,
  processScore,
  sessionDateOf,
  sessionResult,
  tradingBook,
  tradingDayReader,
} from '../trading';
import { DAYS, TODAY, twoYears } from '../../test-support/two-years';

// Two years of synthetic history: the indexed readers must return exactly what the reference
// implementations below return, and must not slow down quadratically.

// Reference implementation: one date at a time, scanning every review.
function referenceStart(state: State, book: RuleBook): string {
  const dates = state.ruleReviews
    .filter((r) => r.routineId === book.routineId && isTradingReview(r))
    .map((r) => r.date)
    .sort();
  return dates[0] && dates[0] < book.trading!.since ? dates[0] : book.trading!.since;
}
function referenceDay(state: State, book: RuleBook, date: string, today: string): TradingDay {
  const profile = book.trading!;
  const review = state.ruleReviews.find(
    (r) => r.routineId === book.routineId && r.date === date && isTradingReview(r),
  );
  if (review) {
    const result = sessionResult(review, profile);
    return {
      date,
      status: result,
      review,
      score: result === 'away' ? undefined : processScore(review, profile).passed,
    };
  }
  const older = state.ruleReviews.find((r) => r.routineId === book.routineId && r.date === date);
  if (older) return { date, status: 'older', review: older };
  if (date < referenceStart(state, book)) return { date, status: 'before' };
  const day = state.days[date];
  const block = day?.blocks.find((b) => b.routineId === book.routineId && !b.optional);
  if (!block) return { date, status: 'none' };
  if (day!.protection) return { date, status: 'held' };
  if (date >= today) return { date, status: date === today ? 'open' : 'none' };
  return { date, status: 'missed' };
}

describe('two years of history', () => {
  const state = twoYears();
  const book = tradingBook(state)!;

  it('reads every trading date exactly as the reference does', () => {
    const read = tradingDayReader(state, book);
    for (let i = 0; i <= DAYS + 2; i++) {
      const date = shiftDate(TODAY, -DAYS + i);
      expect(read(date, TODAY)).toEqual(referenceDay(state, book, date, TODAY));
    }
    const statuses = new Set(
      Array.from({ length: DAYS }, (_, i) => read(shiftDate(TODAY, -DAYS + i), TODAY).status),
    );
    for (const s of ['clean', 'broken', 'away', 'older', 'missed', 'held', 'none'])
      expect(statuses).toContain(s);
  });

  it('keeps the clean streak and is fast at this size', () => {
    let run = 0;
    let best = 0;
    for (let d = referenceStart(state, book); d <= TODAY; d = shiftDate(d, 1)) {
      const { status } = referenceDay(state, book, d, TODAY);
      if (status === 'clean') best = Math.max(best, ++run);
      else if (status === 'broken' || status === 'missed') run = 0;
    }
    const started = Date.now();
    expect(cleanStreak(state, book, TODAY)).toEqual({ current: run, best });
    // A coarse tripwire, not a benchmark (about 10 ms here): only a return to scanning every review
    // for every date at a much larger scale would cross it. The equality above is the real check.
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('reads every review an earlier build saved exactly once, and fast', () => {
    // The same history as an earlier build saved it, without the mark this build adds.
    const earlier: State = {
      ...state,
      ruleReviews: state.ruleReviews.map((r) => {
        if (!r.trading) return r;
        const { ownCandle: _mark, ...trading } = r.trading;
        return { ...r, trading };
      }),
    };
    const started = Date.now();
    const read = tradingDayReader(earlier, book);
    const found: string[] = [];
    for (let d = shiftDate(TODAY, -DAYS - 400); d <= TODAY; d = shiftDate(d, 1)) {
      const review = read(d, TODAY).review;
      if (review && isTradingReview(review)) found.push(review.id);
    }
    // A coarse tripwire, as above.
    expect(Date.now() - started).toBeLessThan(5_000);
    // On a US phone each is read on its own date, as this build's are.
    const marked = tradingDayReader(state, book);
    if (sessionDateOf(TODAY) === TODAY)
      for (let d = shiftDate(TODAY, -DAYS - 2); d <= TODAY; d = shiftDate(d, 1)) {
        const [a, b] = [read(d, TODAY), marked(d, TODAY)];
        expect([d, a.status, a.review?.id]).toEqual([d, b.status, b.review?.id]);
      }
    // One review per date, the first in record order, each read once whatever the time zone.
    const firsts = new Set<string>();
    const dates = new Set<string>();
    for (const r of earlier.ruleReviews)
      if (isTradingReview(r) && !dates.has(r.date)) {
        dates.add(r.date);
        firsts.add(r.id);
      }
    expect(found.sort()).toEqual([...firsts].sort());
  });

  it('gives the same streak history for any window as walking every day', () => {
    const full = (through: string, limit: number) => {
      const dates = Object.keys(state.days).sort();
      const all: string[] = [];
      for (let d = dates[0] < through ? dates[0] : through; d <= through; d = shiftDate(d, 1))
        all.push(d);
      return all.slice(-limit);
    };
    for (const through of [TODAY, shiftDate(TODAY, -300), shiftDate(TODAY, -DAYS - 5)])
      for (const limit of [1, 14, 40]) {
        const history = streakHistory(state, through, TODAY, limit);
        expect(history.map((h) => h.date)).toEqual(full(through, limit));
      }
    const started = Date.now();
    dayClearStreak(state, TODAY, TODAY);
    // A coarse tripwire, not a benchmark (about 15 ms here).
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('walks only stored days for the Day Clear streak, with the result of walking every day', () => {
    // Reference implementation: walk every calendar day.
    const everyDay = (s: State, through: string, today: string) => {
      const dates = Object.keys(s.days).sort();
      let current = 0,
        best = 0;
      for (let date = dates[0]; dates.length && date <= through; date = shiftDate(date, 1)) {
        const outcome = dayOutcome(s, date);
        if (outcome === 'cleared') best = Math.max(best, ++current);
        else if (
          outcome === 'open' &&
          !(date >= today && dayProgress(s.days[date], s.programs, date).remaining > 0)
        )
          current = 0;
      }
      return { current, best };
    };
    // Gaps (never-opened days) inside the history, which the stored-day walk skips.
    const gappy = {
      ...state,
      days: Object.fromEntries(Object.entries(state.days).filter(([, d], i) => i % 13 !== 4 || !d)),
    };
    for (const s of [state, gappy])
      for (const through of [
        TODAY,
        shiftDate(TODAY, -1),
        shiftDate(TODAY, -300),
        shiftDate(TODAY, 5),
      ])
        expect(dayClearStreak(s, through, TODAY)).toEqual(everyDay(s, through, TODAY));
    expect(dayClearStreak({ ...state, days: {} }, TODAY, TODAY)).toEqual({ current: 0, best: 0 });
  });

  it('marks private objectives exactly as a routine-by-routine search would', () => {
    const programs = state.programs.map((p) => ({
      ...p,
      routines: p.routines.map((r) => (r.id === DEMO.study ? { ...r, private: true } : r)),
    }));
    const privateIds = new Set(
      programs.flatMap((p) => p.routines.filter((r) => r.private).map((r) => r.id)),
    );
    for (const day of Object.values(state.days).slice(-60))
      for (const leaf of objectiveLeaves(day, programs)) {
        const block = day.blocks.find((b) => b.id === leaf.id);
        expect(leaf.private).toBe(
          !!block?.private || (!!leaf.routineId && privateIds.has(leaf.routineId)),
        );
      }
  });
});
