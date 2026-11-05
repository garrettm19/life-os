import { describe, expect, it } from '@jest/globals';
import {
  AXIS_TEXT_MAX,
  axisDates,
  axisLabel,
  axisLabelWidth,
  fromFirstRecord,
  readoutPlace,
  columnLayout,
  columnLeft,
  labeledScale,
  nearestIndex,
  stepIndex,
  niceScale,
  shiftMiddle,
  shortDate,
  weekRows,
} from '../chart-scale';

describe('chart scale', () => {
  it('widens the plotted range to a labeled line above and below the data', () => {
    // Weigh-ins from 176.3 to 179.4: lines at 176, 178 and 180, so the highest one is labeled.
    expect(niceScale(176.3, 179.4)).toEqual({ lo: 176, hi: 180, ticks: [176, 178, 180] });
    // Cash at $1,435 sits under the $1.5k line, not above the $1.4k one (cents).
    expect(niceScale(120_000, 143_500).hi).toBeGreaterThanOrEqual(143_500);
    // Bars and counts from zero.
    expect(niceScale(0, 95)).toEqual({ lo: 0, hi: 100, ticks: [0, 50, 100] });
    // A value exactly on a round step keeps it as the top line.
    expect(niceScale(0, 90).hi).toBe(100);
    expect(niceScale(0, 60)).toEqual({ lo: 0, hi: 60, ticks: [0, 20, 40, 60] });
  });

  it('keeps a small range from looking steep and a flat one visible', () => {
    // Reps of 5 to 7 are drawn over at least four reps.
    const reps = niceScale(5, 7, { minSpan: 4, floor: 0 });
    expect(reps.hi - reps.lo).toBeGreaterThanOrEqual(4);
    expect(reps.ticks[0]).toBeLessThanOrEqual(5);
    expect(reps.ticks.at(-1)).toBeGreaterThanOrEqual(7);
    // Never below zero for a count.
    expect(niceScale(1, 2, { minSpan: 4, floor: 0 }).lo).toBe(0);
    const flat = niceScale(180, 180);
    expect(flat.lo).toBeLessThan(180);
    expect(flat.hi).toBeGreaterThan(180);
  });

  it('widens the step until every line has its own label, the top one included', () => {
    // Two weigh-ins 0.1 lb apart: 180.05 would read 180.1 and take the top line's label.
    const weight = (y: number) => y.toFixed(1);
    expect(niceScale(180, 180.1, { floor: 0 }).ticks.map(weight)).toEqual([
      '180.0',
      '180.1',
      '180.1',
    ]);
    const scale = labeledScale(180, 180.1, weight, { floor: 0 });
    expect(scale).toEqual({ lo: 180, hi: 180.1, ticks: [180, 180.1] });
    // Money labels in $0.1k steps over a $50 range.
    const money = (cents: number) => `$${(cents / 100_000).toFixed(1)}k`;
    const cash = labeledScale(480_000, 485_000, money);
    const labels = cash.ticks.map(money);
    expect(new Set(labels).size).toBe(labels.length);
    expect(cash.hi).toBeGreaterThanOrEqual(485_000);
    expect(cash.lo).toBeLessThanOrEqual(480_000);
    // A format as fine as the step changes nothing.
    expect(labeledScale(176.3, 179.4, weight)).toEqual(niceScale(176.3, 179.4));
  });

  it('lays a calendar out in Monday-to-Sunday rows, the rest of this week empty', () => {
    const days = Array.from({ length: 24 }, (_, i) => i);
    const rows = weekRows(days);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(rows[3]).toEqual([21, 22, 23, null, null, null, null]);
    expect(weekRows(Array.from({ length: 28 }, (_, i) => i))[3]).not.toContain(null);
  });

  it('labels dates briefly and finds a middle date', () => {
    expect(shortDate('2026-09-14')).toBe('Sep 14');
    expect(shortDate('2026-12-01')).toBe('Dec 1');
    // Across the November clock change.
    expect(shiftMiddle('2026-10-25', 14, 3)).toBe('2026-11-01');
  });
});

describe('chart touch and layout', () => {
  it('snaps a touch to the nearest point, the earlier one on a tie', () => {
    expect(nearestIndex([10, 50, 90], 0)).toBe(0);
    expect(nearestIndex([10, 50, 90], 68)).toBe(1);
    expect(nearestIndex([10, 50, 90], 71)).toBe(2);
    expect(nearestIndex([10, 50, 90], 400)).toBe(2);
    expect(nearestIndex([10, 50], 30)).toBe(0);
    expect(nearestIndex([42], 300)).toBe(0);
  });

  it('steps through the points for VoiceOver and the arrow keys, from the latest', () => {
    expect(stepIndex(null, 5, 'next')).toBe(4);
    expect(stepIndex(null, 5, 'previous')).toBe(4);
    expect(stepIndex(4, 5, 'previous')).toBe(3);
    expect(stepIndex(4, 5, 'next')).toBe(4);
    expect(stepIndex(0, 5, 'previous')).toBe(0);
    expect(stepIndex(2, 5, 'first')).toBe(0);
    expect(stepIndex(2, 5, 'last')).toBe(4);
  });

  it('caps columns at 24 pt and keeps a gap between neighbors at every range', () => {
    // 4 weeks across 280 pt: wide slots, capped columns.
    expect(columnLayout(4, 280)).toEqual({ slot: 70, column: 24 });
    // 12 weeks: 70% of the slot, in whole points.
    expect(columnLayout(12, 288).column).toBe(16);
    // 52 weeks across 260 pt: 5 pt slots, 3 pt columns, a 2 pt gap.
    const year = columnLayout(52, 260);
    expect(year.slot).toBe(5);
    expect(year.column).toBe(3);
    // A year at 320 pt (about 248 pt of plot): every column 2 pt, never a hairline.
    expect(columnLayout(52, 248).column).toBe(2);
    expect(columnLayout(52, 60).column).toBe(2);
  });

  it('puts every column on whole points, so a year of columns renders at one width', () => {
    const { slot, column } = columnLayout(52, 248);
    const lefts = Array.from({ length: 52 }, (_, i) => columnLeft(36 + slot * (i + 0.5), column));
    lefts.forEach((left, i) => {
      expect(Number.isInteger(left)).toBe(true);
      // Neighbors never touch: at least a 2 pt gap.
      if (i) expect(left - lefts[i - 1] - column).toBeGreaterThanOrEqual(2);
    });
  });

  it('labels the ends of the axis, and the middle only with room and a long span', () => {
    expect(axisDates('2026-10-05', '2026-10-05', 0, 300)).toEqual(['2026-10-05']);
    expect(axisDates('2026-09-01', '2026-10-01', 30, 300)).toEqual([
      '2026-09-01',
      '2026-09-16',
      '2026-10-01',
    ]);
    expect(axisDates('2026-09-01', '2026-10-01', 30, 200)).toHaveLength(2);
    expect(axisDates('2026-09-21', '2026-10-05', 14, 300)).toHaveLength(2);
  });

  it('labels the middle of a weekly chart with the Monday nearest the midpoint', () => {
    // 12 weeks, Jul 27 to Oct 12: the midpoint Sep 4 is a Friday; its nearest Monday is Sep 7.
    expect(axisDates('2026-07-27', '2026-10-12', 77, 300, true)).toEqual([
      '2026-07-27',
      '2026-09-07',
      '2026-10-12',
    ]);
    // A year of weeks: Oct 20, 2025 to Oct 12, 2026.
    const year = axisDates('2025-10-20', '2026-10-12', 357, 300, true);
    // The midpoint Apr 17 is a Friday: Apr 20 is nearer than Apr 13.
    expect(year[1]).toBe('2026-04-20');
    expect(new Date(2026, 3, 20).getDay()).toBe(1);
  });

  it('gives an axis label its year when it is not the year of the last date', () => {
    expect(axisLabel('2025-10-20', '2026-10-12')).toBe('Oct 20, 2025');
    expect(axisLabel('2026-04-13', '2026-10-12')).toBe('Apr 13');
    expect(axisLabel('2026-12-14', '2027-01-04')).toBe('Dec 14, 2026');
    expect(axisLabel('2027-01-04', '2027-01-04')).toBe('Jan 4');
  });

  it('sizes an axis label for the largest text the axis allows', () => {
    // Sized at 6.5 pt a character at 1.2× (7.8 pt): "Oct 20, 2025" gets 94 pt. The axis's 10 pt
    // SF Pro Semibold averages about 5 pt a character on a date (about 72 pt here at 1.2×).
    expect(AXIS_TEXT_MAX).toBe(1.2);
    expect(axisLabelWidth('Oct 20, 2025')).toBeGreaterThanOrEqual(86);
    expect(axisLabelWidth('Oct 20')).toBe(64);
  });

  it('labels a count only on whole numbers', () => {
    // A new plan's first week of study: no "0.5 study days" line.
    expect(niceScale(0, 1, { whole: true }).ticks).toEqual([0, 1]);
    expect(niceScale(0, 1).ticks).toEqual([0, 0.5, 1]);
    // A perfect daily week tops out at 7: no 2.5 or 7.5 lines.
    expect(niceScale(0, 7, { whole: true })).toEqual({ lo: 0, hi: 8, ticks: [0, 2, 4, 6, 8] });
    expect(niceScale(0, 7).ticks).toEqual([0, 2.5, 5, 7.5]);
    for (let hi = 1; hi <= 40; hi++) {
      const { ticks, hi: top } = niceScale(0, hi, { whole: true });
      expect(ticks.every(Number.isInteger)).toBe(true);
      expect(top).toBeGreaterThanOrEqual(hi);
      expect(ticks.length).toBeLessThanOrEqual(5);
    }
  });

  it('puts the readout on the half of the plot away from the point it reads', () => {
    expect(readoutPlace(40, 300)).toEqual({ side: 'right', maxWidth: 142 });
    expect(readoutPlace(260, 300)).toEqual({ side: 'left', maxWidth: 142 });
    // Its far edge never reaches the middle, so the selected point is never under it.
    for (const x of [0, 100, 149, 150, 151, 299]) {
      const { side, maxWidth } = readoutPlace(x, 300);
      if (side === 'right') expect(300 - maxWidth).toBeGreaterThan(x);
      else expect(maxWidth).toBeLessThan(x);
    }
  });

  it('starts weekly columns at the first week with a record, keeping later gaps', () => {
    const w = (value: number | null) => ({ value });
    expect(fromFirstRecord([w(null), w(null), w(3), w(null), w(0)])).toEqual([w(3), w(null), w(0)]);
    const all = [w(1), w(null)];
    expect(fromFirstRecord(all)).toBe(all);
    const none = [w(null), w(null)];
    expect(fromFirstRecord(none)).toBe(none);
  });
});
