import { describe, expect, it } from '@jest/globals';
import {
  ON_TIME_GRACE,
  anchorCaption,
  canCarryAnchor,
  anchorRoutine,
  backOnTime,
  correctMorning,
  firstTick,
  morningOn,
  recentMornings,
  upByOn,
  withAnchorTime,
} from '../anchor';
import { decodeState, parseSetup, withDay } from '../data';
import { State, displayTime, shiftDate } from '../model';
import { dayMoments } from '../moments';
import { dayOutcome } from '../objectives';
import { mornings } from '../progress';
import { ensureChecklistDay, setStatus } from '../planner';
import { upsertRoutine } from '../routines';
import { UP_BY, anchorState } from '../../test-support/fixtures';

// The anchor starts Monday, November 2, 2026 at 7:10 AM; the US clock change
// is the night of Sunday, November 1. Every time is built from the local calendar, so each zone the
// suite runs in (UTC, Kiritimati, New York, Los Angeles) judges the same local mornings.
const START = '2026-11-02';
const at = (date: string, hour: number, minute = 0) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute).toISOString();
};
const id = (date: string) => `${date}:routine:up`;
const anchor = (state: State) => anchorRoutine(state)!;

function open(state: State, date: string, now = at(date, 5)): State {
  return withDay(
    state,
    ensureChecklistDay(date, state.settings, state.programs, state.days[date], now),
  );
}
/** Opens the day and ticks the anchor at a local time. */
function tick(state: State, date: string, hour: number, minute = 0): State {
  const opened = open(state, date);
  return withDay(opened, setStatus(opened.days[date], id(date), 'done', at(date, hour, minute)));
}
const mark = (state: State, date: string, today: string) =>
  morningOn(state, anchor(state), date, today).mark;
const caption = (state: State, date: string, today = date) =>
  anchorCaption(state, anchor(state), date, today);
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => shiftDate(from, i));

describe('a morning is judged against the anchor time in force that day', () => {
  it('on time up to 15 minutes after the anchor time, earlier always, later never', () => {
    let s = anchorState();
    s = tick(s, '2026-11-02', 7, 6);
    s = tick(s, '2026-11-03', 7, 10 + ON_TIME_GRACE);
    s = tick(s, '2026-11-04', 7, 10 + ON_TIME_GRACE + 1);
    s = tick(s, '2026-11-05', 4, 30);
    s = tick(s, '2026-11-06', 13, 0);
    const today = '2026-11-07';
    expect(days('2026-11-02', 5).map((d) => mark(s, d, today))).toEqual([
      'on-time',
      'on-time',
      'late',
      'on-time',
      'late',
    ]);
    expect(morningOn(s, anchor(s), '2026-11-04', today)).toMatchObject({
      at: 7 * 60 + 26,
      upBy: UP_BY,
      corrected: false,
    });
  });

  it('tells a day never opened, a day left open, a skip and a day it was not due apart', () => {
    let s = anchorState();
    // Not due on Saturdays from here on: a Saturday opened shows no anchor.
    s.programs[0].routines[0].weekdays = [0, 1, 2, 3, 4, 5];
    s = open(s, '2026-11-02');
    s = open(s, '2026-11-03');
    s = withDay(
      s,
      setStatus(s.days['2026-11-03'], id('2026-11-03'), 'skipped', at('2026-11-03', 9)),
    );
    s = open(s, '2026-11-07');
    s = open(s, '2026-11-09');
    const today = '2026-11-09';
    expect(mark(s, '2026-11-01', today)).toBe('before');
    expect(mark(s, '2026-11-02', today)).toBe('not-ticked');
    expect(mark(s, '2026-11-03', today)).toBe('skipped');
    // Never opened: not recorded, neutral.
    expect(mark(s, '2026-11-04', today)).toBe('none');
    expect(mark(s, '2026-11-07', today)).toBe('free');
    expect(mark(s, '2026-11-09', today)).toBe('open');
  });

  it('a tick recorded on a later day, or without a time, is never on time', () => {
    let s = open(anchorState(), '2026-11-02');
    s = withDay(s, setStatus(s.days['2026-11-02'], id('2026-11-02'), 'done', at('2026-11-03', 7)));
    expect(mark(s, '2026-11-02', '2026-11-03')).toBe('late');
    s = open(s, '2026-11-03');
    s.days['2026-11-03'].blocks = s.days['2026-11-03'].blocks.map((b) =>
      b.id === id('2026-11-03') ? { ...b, status: 'done', actualAt: null } : b,
    );
    expect(morningOn(s, anchor(s), '2026-11-03', '2026-11-03')).toMatchObject({
      mark: 'late',
      at: null,
    });
    expect(caption(s, '2026-11-03')).toBe('Ticked');
  });

  it('is right on the day the clocks change and the days around it', () => {
    let s = anchorState('2026-10-30');
    // Sunday, November 1 is 25 hours long in New York and Los Angeles; the wall clock still decides.
    s = tick(s, '2026-10-31', 7, 25);
    s = tick(s, '2026-11-01', 7, 25);
    s = tick(s, '2026-11-02', 7, 26);
    s = tick(s, '2026-11-01', 7, 20);
    expect(mark(s, '2026-10-31', '2026-11-02')).toBe('on-time');
    expect(mark(s, '2026-11-01', '2026-11-02')).toBe('on-time');
    expect(morningOn(s, anchor(s), '2026-11-01', '2026-11-02').at).toBe(7 * 60 + 20);
    expect(mark(s, '2026-11-02', '2026-11-02')).toBe('late');
    // Ticked just after local midnight on the clock-change day belongs to that day.
    let t = anchorState('2026-10-30');
    t = tick(t, '2026-11-01', 0, 30);
    expect(morningOn(t, anchor(t), '2026-11-01', '2026-11-01')).toMatchObject({
      mark: 'on-time',
      at: 30,
    });
  });
});

describe('the anchor time is append-only', () => {
  it('a change of time applies from its day on and re-judges no earlier morning', () => {
    let s = tick(anchorState(), '2026-11-02', 7, 20);
    s = tick(s, '2026-11-03', 7, 20);
    const before = days('2026-11-02', 2).map((d) => mark(s, d, '2026-11-04'));
    // Set to 7:00 on Wednesday, November 4.
    const routine = withAnchorTime(anchor(s), 420, '2026-11-04');
    s = upsertRoutine(s, s.programs[0], routine, at('2026-11-04', 12));
    expect(anchor(s).anchor!.history).toEqual([
      { from: START, upBy: UP_BY },
      { from: '2026-11-04', upBy: 420 },
    ]);
    expect(days('2026-11-02', 2).map((d) => mark(s, d, '2026-11-04'))).toEqual(before);
    expect(before).toEqual(['on-time', 'on-time']);
    s = tick(s, '2026-11-04', 7, 20);
    expect(mark(s, '2026-11-04', '2026-11-04')).toBe('late');
    expect(upByOn(anchor(s), '2026-11-03')).toBe(UP_BY);
    expect(upByOn(anchor(s), '2026-11-05')).toBe(420);
  });

  it('a second change the same day replaces that day, and the same time adds nothing', () => {
    const r = anchor(anchorState());
    const once = withAnchorTime(r, 420, '2026-11-04');
    const twice = withAnchorTime(once, 405, '2026-11-04');
    expect(twice.anchor!.history).toEqual([
      { from: START, upBy: UP_BY },
      { from: '2026-11-04', upBy: 405 },
    ]);
    expect(withAnchorTime(twice, 405, '2026-11-09')).toBe(twice);
  });

  it('a first time can count mornings from the first tick, never from a later date', () => {
    let s = anchorState();
    const plain = { ...anchor(s) };
    delete plain.anchor;
    s.programs[0].routines = [plain];
    s = tick(s, '2026-10-26', 7, 0);
    s = tick(s, '2026-10-28', 7, 40);
    const first = firstTick(s, 'up', '2026-11-02');
    expect(first).toBe('2026-10-26');
    const counted = withAnchorTime(plain, UP_BY, '2026-11-02', first!);
    expect(counted.anchor!.history).toEqual([{ from: '2026-10-26', upBy: UP_BY }]);
    const today = withAnchorTime(plain, UP_BY, '2026-11-02');
    expect(today.anchor!.history).toEqual([{ from: '2026-11-02', upBy: UP_BY }]);
    // A start after the day it is set is never taken.
    expect(withAnchorTime(plain, UP_BY, '2026-11-02', '2026-11-09').anchor!.history[0].from).toBe(
      '2026-11-02',
    );
    expect(() => withAnchorTime(plain, 1440, '2026-11-02')).toThrow();
  });

  it('a time counted from earlier mornings stays with them when changed the same day', () => {
    const plain = { ...anchor(anchorState()) };
    delete plain.anchor;
    const counted = withAnchorTime(plain, 421, '2026-11-20', '2026-11-02');
    const changed = withAnchorTime(counted, UP_BY, '2026-11-20');
    // The history cannot tell this change from one made weeks later, so the counted mornings keep
    // their time; ending the anchor and setting it again is the correction the editor names.
    expect(changed.anchor!.history).toEqual([
      { from: '2026-11-02', upBy: 421 },
      { from: '2026-11-20', upBy: UP_BY },
    ]);
    const ended = { ...changed };
    delete ended.anchor;
    expect(withAnchorTime(ended, UP_BY, '2026-11-20', '2026-11-02').anchor!.history).toEqual([
      { from: '2026-11-02', upBy: UP_BY },
    ]);
  });
});

describe('the caption on Today', () => {
  it('before the tick: the recent count once one morning was on time, never the time the title gives', () => {
    // The fixture's title is "Up by 7:10", so the caption never repeats the time under it.
    let s = anchorState();
    s = open(s, '2026-11-02');
    expect(caption(s, '2026-11-02')).toBeNull();
    s = tick(s, '2026-11-02', 8, 2);
    s = open(s, '2026-11-03');
    // A late morning is not counted out loud: no "0 of".
    expect(caption(s, '2026-11-03')).toBeNull();
    for (const d of days('2026-11-03', 5)) s = tick(s, d, 7, 4);
    s = open(s, '2026-11-08');
    expect(caption(s, '2026-11-08')).toBe('On time 5 of the last 6');
    s = tick(s, '2026-11-08', 7, 5);
    s = open(s, '2026-11-09');
    expect(caption(s, '2026-11-09')).toBe('On time 6 of the last 7');
    // Another date than today has no count.
    expect(caption(s, '2026-11-10', '2026-11-09')).toBeNull();
    // A title that does not give the time keeps it in the caption.
    s.programs[0].routines[0].title = 'Get up';
    expect(caption(s, '2026-11-09')).toBe('Up by 7:10 AM · on time 6 of the last 7');
    expect(caption(s, '2026-11-10', '2026-11-09')).toBe(`Up by ${displayTime(UP_BY)}`);
  });

  it('once ticked: the tick time in the same words whether on time or after the window', () => {
    let s = tick(anchorState(), '2026-11-02', 7, 6);
    expect(caption(s, '2026-11-02')).toBe('Ticked 7:06 AM');
    s = tick(s, '2026-11-03', 8, 2);
    expect(caption(s, '2026-11-03')).toBe('Ticked 8:02 AM');
  });

  it('says Back on time for the first on-time tick after a morning that was not', () => {
    let s = tick(anchorState(), '2026-11-02', 7, 6);
    s = tick(s, '2026-11-03', 8, 2);
    s = tick(s, '2026-11-04', 7, 9);
    expect(caption(s, '2026-11-04')).toBe('Back on time · 7:09 AM');
    expect(backOnTime(s, anchor(s), '2026-11-04', '2026-11-04')).toBe(true);
    // The next on-time morning is an ordinary one.
    s = tick(s, '2026-11-05', 7, 1);
    expect(caption(s, '2026-11-05')).toBe('Ticked 7:01 AM');
    // A day never opened is neutral, so the morning after it is an ordinary one; the anchor's first
    // morning is never "back".
    s = tick(s, '2026-11-07', 7, 0);
    expect(caption(s, '2026-11-07')).toBe('Ticked 7:00 AM');
    expect(backOnTime(s, anchor(s), '2026-11-02', '2026-11-07')).toBe(false);
  });

  it('passes over a day skipped or never opened, and is back only after a judged morning', () => {
    // A week on time, then Sunday never opened and Monday skipped: Tuesday on time is not "back".
    let s = anchorState();
    for (const d of days('2026-11-02', 6)) s = tick(s, d, 7, 0);
    s = open(s, '2026-11-09');
    s = withDay(
      s,
      setStatus(s.days['2026-11-09'], id('2026-11-09'), 'skipped', at('2026-11-09', 9)),
    );
    s = tick(s, '2026-11-10', 7, 1);
    expect(caption(s, '2026-11-10')).toBe('Ticked 7:01 AM');
    expect(dayMoments(s, '2026-11-10', '2026-11-10').some((m) => m.kind === 'morning')).toBe(false);
    // After a morning ticked late, the neutral days between are passed over and it is "back".
    let t = tick(anchorState(), '2026-11-02', 7, 0);
    t = tick(t, '2026-11-03', 8, 30);
    t = tick(t, '2026-11-06', 7, 0);
    expect(caption(t, '2026-11-06')).toBe('Back on time · 7:00 AM');
  });

  it('a corrected morning that is also back keeps its corrected mark', () => {
    let s = tick(anchorState(), '2026-11-02', 7, 0);
    s = tick(s, '2026-11-03', 8, 30);
    s = tick(s, '2026-11-04', 9, 0);
    s = withDay(s, correctMorning(s.days['2026-11-04'], id('2026-11-04'), 7 * 60 + 5));
    expect(caption(s, '2026-11-04')).toBe('Back on time · up at 7:05 AM · corrected');
  });

  it('skips a day the anchor was not due when looking back', () => {
    let s = anchorState();
    s.programs[0].routines[0].weekdays = [1, 2, 3, 4, 5];
    s = tick(s, '2026-11-06', 7, 0);
    s = open(s, '2026-11-07');
    s = open(s, '2026-11-08');
    s = tick(s, '2026-11-09', 7, 0);
    expect(mark(s, '2026-11-07', '2026-11-09')).toBe('free');
    expect(caption(s, '2026-11-09')).toBe('Ticked 7:00 AM');
  });

  it('a weekend the anchor is not due is free even when never opened', () => {
    let s = anchorState();
    s.programs[0].routines[0].weekdays = [1, 2, 3, 4, 5];
    for (const d of days('2026-11-02', 5)) s = tick(s, d, 7, 0);
    s = tick(s, '2026-11-09', 7, 0);
    expect(mark(s, '2026-11-07', '2026-11-09')).toBe('free');
    expect(mark(s, '2026-11-08', '2026-11-09')).toBe('free');
    expect(caption(s, '2026-11-09')).toBe('Ticked 7:00 AM');
    expect(dayMoments(s, '2026-11-09', '2026-11-09').some((m) => m.kind === 'morning')).toBe(false);
    // Nov 3 to 9: five weekday mornings, the weekend left out rather than counted against them.
    expect(recentMornings(s, anchor(s), '2026-11-09')).toEqual({ onTime: 5, days: 5 });
    expect(mornings(s, '2026-11-09')!.headline).toBe('On time 5 of the last 5');
    // A weekday never opened is still not recorded.
    expect(mark(s, '2026-11-10', '2026-11-11')).toBe('none');
  });

  it('never shows a zero, "missed" or a count of mornings that were not on time', () => {
    // Every pattern of the last seven mornings: on time, late, left open, skipped, never opened.
    const kinds = ['on', 'late', 'open', 'skip', 'none'] as const;
    const today = '2026-11-16';
    const captions = new Set<string>();
    for (let n = 0; n < 400; n++) {
      let s = anchorState();
      let x = n * 7919;
      for (const d of days('2026-11-02', 14)) {
        const kind = kinds[x % kinds.length];
        x = Math.floor(x / kinds.length) + n;
        if (kind === 'on') s = tick(s, d, 7, x % 26);
        else if (kind === 'late') s = tick(s, d, 8, x % 60);
        else if (kind === 'open') s = open(s, d);
        else if (kind === 'skip') {
          s = open(s, d);
          s = withDay(s, setStatus(s.days[d], id(d), 'skipped', at(d, 9)));
        }
      }
      s = open(s, today);
      for (const d of days('2026-11-02', 15)) {
        const line = caption(s, d, today);
        if (line) captions.add(line);
      }
      // And today after a tick, on time and late.
      captions.add(caption(tick(s, today, 7, 3), today)!);
      captions.add(caption(tick(s, today, 9, 40), today)!);
    }
    expect(captions.size).toBeGreaterThan(10);
    for (const line of captions) {
      expect(line).not.toMatch(/(?<![\d:])0(?![\d:])/);
      expect(line).not.toMatch(/miss/i);
      expect(line).not.toMatch(/fail|late|broke|lost/i);
    }
  });
});

describe('I was up at', () => {
  it('corrects a forgotten tick to an earlier time, marked corrected, and Undo drops it', () => {
    let s = tick(anchorState(), '2026-11-02', 9, 30);
    expect(mark(s, '2026-11-02', '2026-11-02')).toBe('late');
    s = withDay(s, correctMorning(s.days['2026-11-02'], id('2026-11-02'), 7 * 60 + 5));
    expect(morningOn(s, anchor(s), '2026-11-02', '2026-11-02')).toMatchObject({
      mark: 'on-time',
      at: 425,
      corrected: true,
    });
    // The first morning is never "back", so the correction says so.
    expect(caption(s, '2026-11-02')).toBe('Up at 7:05 AM · corrected');
    // It is a stored record that survives a save and a reload.
    expect(decodeState(JSON.parse(JSON.stringify(s))).days['2026-11-02'].blocks[0].upAt).toBe(425);
    // Undo, then a fresh tick: the correction belonged to the old tick.
    s = withDay(s, setStatus(s.days['2026-11-02'], id('2026-11-02'), 'planned'));
    expect(
      s.days['2026-11-02'].blocks.find((b) => b.id === id('2026-11-02'))!.upAt,
    ).toBeUndefined();
    s = tick(s, '2026-11-02', 9, 31);
    expect(mark(s, '2026-11-02', '2026-11-02')).toBe('late');
  });

  it('takes only a time before the tick, on a done tick, and can be removed', () => {
    let s = tick(anchorState(), '2026-11-02', 7, 30);
    const day = s.days['2026-11-02'];
    expect(() => correctMorning(day, id('2026-11-02'), 7 * 60 + 31)).toThrow(/before the tick/);
    expect(() => correctMorning(day, id('2026-11-02'), 1440)).toThrow();
    s = withDay(s, correctMorning(day, id('2026-11-02'), 7 * 60));
    s = withDay(s, correctMorning(s.days['2026-11-02'], id('2026-11-02'), null));
    expect(morningOn(s, anchor(s), '2026-11-02', '2026-11-02').corrected).toBe(false);
    const planned = open(anchorState(), '2026-11-02').days['2026-11-02'];
    expect(() => correctMorning(planned, id('2026-11-02'), 400)).toThrow(/Tick it first/);
  });
});

describe('the anchor is an ordinary checklist objective', () => {
  it('a late tick still clears the day, and Back on time is a moment of the cleared day', () => {
    let s = anchorState();
    // Only the anchor is due: the training routines rest on these days.
    s.programs = s.programs.map((p) =>
      p.id === 'mornings'
        ? p
        : { ...p, routines: p.routines.map((r) => ({ ...r, enabled: false })) },
    );
    s = tick(s, '2026-11-02', 9, 45);
    expect(dayOutcome(s, '2026-11-02')).toBe('cleared');
    s = tick(s, '2026-11-03', 7, 2);
    expect(dayOutcome(s, '2026-11-03')).toBe('cleared');
    expect(dayMoments(s, '2026-11-03', '2026-11-03')).toContainEqual(
      expect.objectContaining({ kind: 'morning', title: 'Back on time' }),
    );
    expect(dayMoments(s, '2026-11-02', '2026-11-03').some((m) => m.kind === 'morning')).toBe(false);
  });

  it('the rolling count counts only judged mornings: a skip or a day never opened is neutral', () => {
    let s = anchorState();
    for (const d of ['2026-11-02', '2026-11-05', '2026-11-08']) s = tick(s, d, 7, 0);
    s = open(s, '2026-11-04');
    s = withDay(
      s,
      setStatus(s.days['2026-11-04'], id('2026-11-04'), 'skipped', at('2026-11-04', 9)),
    );
    s = open(s, '2026-11-09');
    // Nov 3, 6 and 7 never opened, Nov 4 skipped: three judged mornings, all on time.
    expect(recentMornings(s, anchor(s), '2026-11-09')).toEqual({ onTime: 3, days: 3 });
    expect(caption(s, '2026-11-09')).toBe('On time 3 of the last 3');
    // A morning left open on an opened day is judged.
    s = open(s, '2026-11-10');
    expect(recentMornings(s, anchor(s), '2026-11-10')).toEqual({ onTime: 2, days: 3 });
  });

  it('the rolling count leaves out days before the anchor and waits for today to be ticked', () => {
    let s = tick(anchorState(), '2026-11-02', 7, 0);
    s = tick(s, '2026-11-03', 7, 0);
    s = open(s, '2026-11-04');
    expect(recentMornings(s, anchor(s), '2026-11-04')).toEqual({ onTime: 2, days: 2 });
    s = tick(s, '2026-11-04', 7, 0);
    expect(recentMornings(s, anchor(s), '2026-11-04')).toEqual({ onTime: 3, days: 3 });
  });
});

describe('stored strictly, with no format version', () => {
  it('accepts the anchor and refuses anything malformed or a second enabled anchor', () => {
    const s = anchorState();
    expect(decodeState(JSON.parse(JSON.stringify(s))).programs[0].routines[0].anchor).toEqual({
      history: [{ from: START, upBy: UP_BY }],
    });
    const bad = (change: (r: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(s));
      change(copy.programs[0].routines[0]);
      return () => decodeState(copy);
    };
    expect(bad((r) => (r.anchor = { history: [] }))).toThrow();
    expect(bad((r) => (r.anchor = { history: [{ from: START, upBy: 1440 }] }))).toThrow();
    expect(bad((r) => (r.anchor = { history: [{ from: START, upBy: 7.5 }] }))).toThrow();
    expect(bad((r) => (r.anchor = { history: [{ from: '2026-13-01', upBy: 400 }] }))).toThrow();
    expect(
      bad(
        (r) =>
          (r.anchor = {
            history: [
              { from: '2026-11-04', upBy: 400 },
              { from: START, upBy: 410 },
            ],
          }),
      ),
    ).toThrow();
    expect(bad((r) => (r.anchor = { history: [{ from: START, upBy: 400 }], extra: 1 }))).toThrow();
    expect(bad((r) => (r.anchor = { history: [{ from: START, upBy: 400, at: 'x' }] }))).toThrow();
    expect(bad((r) => (r.checklist = false))).toThrow(/plain checklist/);
    expect(bad((r) => (r.capture = 'weight'))).toThrow(/plain checklist/);
    const two = JSON.parse(JSON.stringify(s));
    two.programs[0].routines.push({
      ...two.programs[0].routines[0],
      id: 'up-2',
      title: 'Up by 6:40',
      anchor: { history: [{ from: START, upBy: 400 }] },
    });
    expect(() => decodeState(two)).toThrow(/one routine/);
    // A paused routine may keep its anchor beside an enabled one.
    two.programs[0].routines[1].enabled = false;
    expect(() => decodeState(two)).not.toThrow();
  });

  it('refuses an anchor on a rotation workout, by the one rule Programs and imports read', () => {
    const s = anchorState();
    const copy = JSON.parse(JSON.stringify(s));
    copy.programs[0].routines[0].weekdays = [];
    copy.programs[0].rotation = { order: ['up'], restDays: [0], startWith: null };
    expect(() => decodeState(copy)).toThrow(/plain checklist/);
    expect(canCarryAnchor(anchor(s), s)).toBe(true);
    expect(canCarryAnchor(anchor(s), decodeState({ ...copy, programs: s.programs }))).toBe(true);
    expect(canCarryAnchor(anchor(s), { ...s, programs: copy.programs })).toBe(false);
    expect(canCarryAnchor({ ...anchor(s), checklist: false }, s)).toBe(false);
    expect(canCarryAnchor({ ...anchor(s), bundledInto: 'x' }, s)).toBe(false);
    expect(
      canCarryAnchor(anchor(s), {
        ...s,
        intervalRoutines: [{ routineId: 'up' } as State['intervalRoutines'][number]],
      }),
    ).toBe(false);
  });

  it('refuses a corrected time on anything but a done tick', () => {
    const s = tick(anchorState(), '2026-11-02', 7, 30);
    const copy = JSON.parse(JSON.stringify(s));
    copy.days['2026-11-02'].blocks[0].upAt = 2000;
    expect(() => decodeState(copy)).toThrow(/corrected morning/);
    copy.days['2026-11-02'].blocks[0].upAt = 400;
    copy.days['2026-11-02'].blocks[0].status = 'planned';
    copy.days['2026-11-02'].blocks[0].actualAt = null;
    expect(() => decodeState(copy)).toThrow(/corrected morning/);
  });

  it('a second anchor is refused in Programs with the routine to change', () => {
    const s = anchorState();
    const other = s.programs[0];
    const routine = {
      ...other.routines[0],
      id: 'up-2',
      title: 'Up by 6:40',
      anchor: { history: [{ from: START, upBy: 400 }] },
    };
    expect(() => upsertRoutine(s, other, routine, at(START, 12))).toThrow(
      /Up by 7:10 is already your morning anchor/,
    );
  });
});

describe('a setup import never sets or changes the anchor', () => {
  const NOW = new Date(2026, 10, 9, 12).toISOString();
  const file = (state: State, routine: (r: Record<string, unknown>) => void) => {
    const programs = JSON.parse(JSON.stringify(state.programs));
    routine(programs[0].routines[0]);
    return JSON.stringify({ format: 'life-os-setup-v1', goals: state.goals, programs });
  };

  it('keeps the device history when the file gives the routine another one', () => {
    let s = tick(anchorState(), '2026-11-03', 7, 20);
    expect(mark(s, '2026-11-03', '2026-11-09')).toBe('on-time');
    const raw = file(s, (r) => (r.anchor = { history: [{ from: '2026-01-01', upBy: 300 }] }));
    s = parseSetup(raw, s, NOW);
    expect(anchor(s).anchor).toEqual({ history: [{ from: START, upBy: UP_BY }] });
    expect(mark(s, '2026-11-03', '2026-11-09')).toBe('on-time');
  });

  it('adds none from a file, and keeps the device anchor when the file leaves it out', () => {
    const plain = anchorState();
    delete plain.programs[0].routines[0].anchor;
    const added = parseSetup(
      file(plain, (r) => (r.anchor = { history: [{ from: '2026-01-01', upBy: 300 }] })),
      plain,
      NOW,
    );
    expect(added.programs[0].routines[0].anchor).toBeUndefined();
    // A malformed or second anchor in a file is not read, so it never stops the import.
    const s = anchorState();
    const two = JSON.parse(file(s, (r) => delete r.anchor));
    two.programs[0].routines.push({
      ...two.programs[0].routines[0],
      id: 'up-2',
      title: 'Up by 6:40',
      anchor: { history: [] },
    });
    const kept = parseSetup(JSON.stringify(two), s, NOW);
    expect(kept.programs[0].routines.map((r) => r.anchor)).toEqual([
      { history: [{ from: START, upBy: UP_BY }] },
      undefined,
    ]);
  });

  it('drops the device anchor only where the file makes the routine unable to carry it', () => {
    const s = anchorState();
    const recorded = parseSetup(
      file(s, (r) => (r.capture = 'weight')),
      s,
      NOW,
    );
    expect(recorded.programs[0].routines[0].anchor).toBeUndefined();
    const raw = JSON.parse(file(s, () => undefined));
    raw.programs[0].routines[0].weekdays = [];
    raw.programs[0].rotation = { order: ['up'], restDays: [0], startWith: null };
    const rotated = parseSetup(JSON.stringify(raw), s, NOW);
    expect(rotated.programs[0].routines[0].anchor).toBeUndefined();
  });
});
