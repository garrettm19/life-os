import { demoState } from '../domain/demo';
import { Day, RuleBook, RuleReview, State, dateObject, shiftDate } from '../domain/model';
import { tradingBook } from '../domain/trading';

// Two years of synthetic history for the scale tests: the indexed readers and the Progress
// aggregates must give the reference results and must not slow down quadratically.

export const TODAY = '2026-11-09';
export const DAYS = 730;

/** The demo's six weeks repeated back over two years, with trading reviews of every kind. */
export function twoYears(): State {
  const demo = demoState(TODAY);
  const sample = Object.values(demo.days).filter((d) => d.date < TODAY);
  const days: Record<string, Day> = {};
  for (let i = 0; i < DAYS; i++) {
    const date = shiftDate(TODAY, -DAYS + i);
    const from = sample[i % sample.length];
    days[date] = {
      ...from,
      date,
      blocks: from.blocks.map((b) => ({ ...b, id: b.id.replace(from.date, date) })),
      ...(i % 97 === 5 && {
        protection: { reason: 'travel' as const, at: from.revisions[0]?.at ?? '' },
      }),
    };
  }
  days[TODAY] = demo.days[TODAY];
  const book = tradingBook(demo)!;
  const reviews: RuleReview[] = [];
  const answers = (fail: boolean) =>
    book.trading!.checklist.map((c, i) => ({
      checkpointId: c.id,
      answer: (fail && i === 2 ? 'no' : 'yes') as 'yes' | 'no',
    }));
  for (let i = 0; i < DAYS; i++) {
    const date = shiftDate(TODAY, -DAYS + i);
    const weekday = dateObject(date).getDay();
    if (weekday === 0 || weekday === 6 || i % 11 === 3) continue; // some weekdays left unreviewed
    const kind = i % 9;
    const base = {
      id: `r-${i}`,
      date,
      at: `${date}T20:00:00.000Z`,
      routineId: book.routineId,
      occurrenceId: null,
      note: '',
    };
    if (kind === 4) {
      // An older-format review, without the trading process.
      reviews.push({ ...base, outcome: 'reviewed', answers: [], violations: [] });
      continue;
    }
    reviews.push({
      ...base,
      outcome: kind === 7 ? 'none' : 'reviewed',
      answers: kind === 7 ? [] : answers(kind === 2),
      violations: kind === 5 ? ['hard-1'] : [],
      trading: {
        session: kind === 7 ? 'away' : kind === 1 ? 'no-trade' : 'traded',
        entries: kind === 1 || kind === 7 ? null : 1,
        failedTheses: kind === 1 || kind === 7 ? null : 0,
        // Saved on its candle's date, as this build saves every review.
        ownCandle: true,
      },
    });
    // A second review on the same date: the first one in record order must win.
    if (kind === 8)
      reviews.push({ ...reviews[reviews.length - 1], id: `r-${i}-dup`, violations: ['hard-2'] });
  }
  const books: RuleBook[] = demo.ruleBooks.map((b) => ({
    ...b,
    trading: { ...b.trading!, since: shiftDate(TODAY, -600) },
  }));
  return { ...demo, days, ruleReviews: reviews, ruleBooks: books };
}
