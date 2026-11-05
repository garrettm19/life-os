import { describe, expect, it } from '@jest/globals';
import { encodeBackup, parseBackup } from '../backup';
import { decodeState, withDay } from '../data';
import { deleteLog, logFor, saveLog } from '../lifelog';
import {
  changeSince,
  deleteMeasurement,
  parseWeight,
  recordWeight,
  weightChange,
  weightHistory,
  weightIn,
} from '../measurements';
import { fieldChanges, formatMoney, parseAmount, previousReview, saveMoneyReview } from '../money';
import { dayProgress } from '../objectives';
import { ensureChecklistDay } from '../planner';
import { fromGrams, toGrams } from '../records';
import { State } from '../model';
import { todayWidgetTimeline, widgetDayStatus } from '../widget';
import { AT as OPENED, trainingState } from '../../test-support/fixtures';

// Records are saved after the dates they describe; days are opened earlier, at OPENED.
const AT = new Date(2026, 10, 30, 12).toISOString();

const SUN = '2026-11-15';
const NEXT_SUN = '2026-11-22';

function sunday(state = trainingState(), date = SUN): State {
  return withDay(
    state,
    ensureChecklistDay(date, state.settings, state.programs, state.days[date], OPENED),
  );
}
const weighIn = (state: State, date = SUN) =>
  state.days[date].blocks.find((b) => b.routineId === 'weigh-in')!;
const moneyCheck = (state: State, date = SUN) =>
  state.days[date].blocks.find((b) => b.routineId === 'money-check')!;
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

describe('weekly body weight', () => {
  it('records pounds and kilograms in one canonical unit and reads back what was typed', () => {
    // 180.4 × 453.59237 = 81,828.06 g.
    expect(toGrams(180.4, 'lb')).toBe(81828);
    expect(toGrams(81.8, 'kg')).toBe(81800);
    expect(fromGrams(81828, 'lb')).toBe(180.4);
    expect(fromGrams(81828, 'kg')).toBe(81.8);
    const state = recordWeight(
      sunday(),
      { value: 180.4, unit: 'lb', date: SUN, fasted: true, note: '', occurrence: undefined },
      'w1',
      AT,
    );
    const m = state.measurements[0];
    expect(weightIn(m, 'lb')).toBe(180.4);
    expect(weightIn(m, 'kg')).toBe(81.8);
  });

  it('rejects invalid input with a clear message', () => {
    for (const bad of ['', 'abc', '-180', '1804', '180.456', '18'])
      expect(() => parseWeight(bad, 'lb')).toThrow();
    expect(parseWeight('180,4', 'lb')).toBe(180.4);
    expect(parseWeight('81.8', 'kg')).toBe(81.8);
  });

  it('says a well-formed weight out of range is out of range, however many digits it has', () => {
    expect(() => parseWeight('99999', 'lb')).toThrow('Enter a weight between 20 and 700 lb.');
    expect(() => parseWeight('1000', 'lb')).toThrow('Enter a weight between 20 and 700 lb.');
    expect(() => parseWeight('1000', 'kg')).toThrow('Enter a weight between 9 and 318 kg.');
    expect(() => parseWeight('1804', 'lb')).toThrow('between 20 and 700 lb');
    // A malformed one still gets the format message.
    expect(() => parseWeight('180.456', 'lb')).toThrow('Use a number like 180.4');
  });

  it('saving from the weekly objective marks it Done in the same change', () => {
    const state = sunday();
    const block = weighIn(state);
    const next = recordWeight(
      state,
      {
        value: 180.4,
        unit: 'lb',
        date: SUN,
        fasted: null,
        note: '',
        occurrence: { date: SUN, blockId: block.id },
      },
      'w1',
      AT,
    );
    expect(next.days[SUN].blocks.find((b) => b.id === block.id)!.status).toBe('done');
    expect(next.measurements[0].occurrenceId).toBe(block.id);
    // Correcting it edits the same record and never adds a second completion.
    const corrected = recordWeight(
      next,
      {
        id: 'w1',
        value: 180.2,
        unit: 'lb',
        date: SUN,
        fasted: null,
        note: 'after coffee',
        occurrence: { date: SUN, blockId: block.id },
      },
      'ignored',
      new Date(2026, 10, 30, 13).toISOString(),
    );
    expect(corrected.measurements).toHaveLength(1);
    expect(corrected.measurements[0]).toMatchObject({ id: 'w1', at: AT, note: 'after coffee' });
    expect(corrected.days[SUN].blocks.find((b) => b.id === block.id)!.actualAt).toBe(AT);
  });

  it('prevents an accidental second weight for the same date', () => {
    const once = recordWeight(
      sunday(),
      { value: 180.4, unit: 'lb', date: SUN, fasted: null, note: '' },
      'w1',
      AT,
    );
    expect(() =>
      recordWeight(once, { value: 180.6, unit: 'lb', date: SUN, fasted: null, note: '' }, 'w2', AT),
    ).toThrow(/already recorded/);
  });

  it('a missing week stays missing: no zero, no interpolation', () => {
    let state = recordWeight(
      sunday(),
      { value: 180.4, unit: 'lb', date: '2026-11-01', fasted: null, note: '' },
      'a',
      AT,
    );
    state = recordWeight(
      state,
      { value: 179.8, unit: 'lb', date: SUN, fasted: null, note: '' },
      'b',
      AT,
    );
    const history = weightHistory(state, 'lb');
    expect(history.map((p) => [p.date, p.value, p.change])).toEqual([
      ['2026-11-01', 180.4, null],
      [SUN, 179.8, -0.6],
    ]);
    expect(weightChange(history)!.change).toBe(-0.6);
    expect(weightChange(history.slice(0, 1))).toBeNull();
    // Each change names the entry it is measured from: by date two weeks back, by weekday within a
    // week.
    expect(changeSince(history[0], 'lb')).toBeNull();
    expect(changeSince(history[1], 'lb')).toBe('−0.6 lb since Nov 1');
    expect(changeSince({ ...history[1], days: 5, change: 0.4 }, 'lb')).toBe('+0.4 lb since Tue');
    expect(changeSince({ ...history[1], days: 2, change: 0 }, 'kg')).toBe('±0 kg since Fri');
  });

  it('deleting a weight removes only that record and leaves the objective as recorded', () => {
    const state = sunday();
    const block = weighIn(state);
    const saved = recordWeight(
      state,
      {
        value: 180.4,
        unit: 'lb',
        date: SUN,
        fasted: null,
        note: '',
        occurrence: { date: SUN, blockId: block.id },
      },
      'w1',
      AT,
    );
    const deleted = deleteMeasurement(saved, 'w1');
    expect(deleted.measurements).toEqual([]);
    expect(deleted.days[SUN]).toBe(saved.days[SUN]);
  });

  it('is not part of the widget and is private by default', () => {
    const state = sunday();
    expect(weighIn(state).private).toBe(true);
    const saved = recordWeight(
      state,
      {
        value: 180.4,
        unit: 'lb',
        date: SUN,
        fasted: null,
        note: '',
        occurrence: { date: SUN, blockId: weighIn(state).id },
      },
      'w1',
      AT,
    );
    const published = JSON.stringify([
      todayWidgetTimeline(
        { ...saved, settings: { ...saved.settings, widgetDayStatus: true } },
        new Date(2026, 10, 15, 9),
      ),
      dayProgress(saved.days[SUN], saved.programs, SUN, { publicOnly: true }),
      widgetDayStatus(saved, SUN),
    ]);
    expect(published).not.toMatch(/180|81\.8|weigh/i);
  });
});

describe('weekly money review', () => {
  it('parses amounts into exact integer cents and keeps blank distinct from zero', () => {
    expect(parseAmount('2,500')).toBe(250000);
    expect(parseAmount('$2,500.5')).toBe(250050);
    expect(parseAmount('0.10')).toBe(10);
    expect(parseAmount('0')).toBe(0);
    expect(parseAmount('  ')).toBeNull();
    for (const bad of ['-5', '1.234', 'abc', '1e5']) expect(() => parseAmount(bad)).toThrow();
    // 0.1 + 0.2 style drift cannot happen: cents are integers end to end.
    expect(formatMoney(parseAmount('0.10')! + parseAmount('0.20')!)).toBe('$0.30');
    expect(formatMoney(123456789)).toBe('$1,234,567.89');
  });

  it('says a huge amount is too large, never that it has a minus sign', () => {
    for (const big of ['99999999999999', '99,999,999,999,999', '$ 1,000,000,000,000'])
      expect(() => parseAmount(big)).toThrow('That amount is too large.');
    // The largest amount a record holds is accepted, as the record validator accepts it.
    expect(parseAmount('100000000000')).toBe(10_000_000_000_000);
    expect(() => parseAmount('100000000000.01')).toThrow('That amount is too large.');
  });

  it('reports actual change only where both reviews reported a figure', () => {
    let state = sunday();
    state = saveMoneyReview(
      state,
      { ...base, date: '2026-11-08', savings: 250000, debt: 400000 },
      'r1',
      AT,
    );
    const block = moneyCheck(state);
    state = saveMoneyReview(
      state,
      {
        ...base,
        date: SUN,
        savings: 270000,
        debt: 385000,
        cash: null,
        nextAction: 'Move $100 to savings',
        occurrence: { date: SUN, blockId: block.id },
      },
      'r2',
      AT,
    );
    expect(state.days[SUN].blocks.find((b) => b.id === block.id)!.status).toBe('done');
    const current = state.moneyReviews.find((r) => r.id === 'r2')!;
    const since = previousReview(state, SUN, 'r2')!.date;
    const [cash, savings, debt] = fieldChanges(state, current);
    expect(cash).toMatchObject({ field: 'cash', value: null, delta: null, previous: null });
    expect(savings).toMatchObject({ value: 270000, delta: 20000, previous: { date: since } });
    expect(debt).toMatchObject({ value: 385000, delta: -15000, previous: { date: since } });
  });

  it('never compares different currencies or invents a target', () => {
    const state = saveMoneyReview(
      sunday(),
      { ...base, date: '2026-11-08', savings: 100000, currency: 'EUR' },
      'r1',
      AT,
    );
    const next = saveMoneyReview(state, { ...base, date: SUN, savings: 120000 }, 'r2', AT);
    const changes = fieldChanges(next, next.moneyReviews[1]);
    expect(changes.every((c) => c.delta === null && c.previous === null)).toBe(true);
    expect(next.moneyReviews[1].savingsTarget).toBeNull();
  });

  it('refuses an empty review, a second review for one objective and invalid amounts', () => {
    const state = sunday();
    expect(() => saveMoneyReview(state, { ...base, date: SUN }, 'r1', AT)).toThrow(/at least one/);
    const block = moneyCheck(state);
    const once = saveMoneyReview(
      state,
      { ...base, date: SUN, cash: 1, occurrence: { date: SUN, blockId: block.id } },
      'r1',
      AT,
    );
    expect(() =>
      saveMoneyReview(
        once,
        { ...base, date: SUN, cash: 2, occurrence: { date: SUN, blockId: block.id } },
        'r2',
        AT,
      ),
    ).toThrow(/already has a review/);
    expect(() => saveMoneyReview(state, { ...base, date: SUN, cash: 1.5 }, 'r1', AT)).toThrow();
  });

  it('correcting one week leaves other weeks untouched', () => {
    let state = saveMoneyReview(sunday(), { ...base, date: '2026-11-08', savings: 1000 }, 'r1', AT);
    state = saveMoneyReview(state, { ...base, date: SUN, savings: 2000 }, 'r2', AT);
    const before = state.moneyReviews[0];
    state = saveMoneyReview(state, { ...base, id: 'r2', date: SUN, savings: 2500 }, 'x', AT);
    expect(state.moneyReviews[0]).toBe(before);
    expect(state.moneyReviews[1].savings).toBe(2500);
  });
});

describe('life log', () => {
  it('adds, edits and deletes one entry without touching others or Day Cleared', () => {
    const state = sunday();
    const progress = dayProgress(state.days[SUN], state.programs, SUN);
    let next = saveLog(
      state,
      {
        text: ' Good day overall ',
        date: SUN,
        category: null,
        energy: null,
        mood: 4,
        goalId: null,
      },
      'l1',
      AT,
    );
    next = saveLog(
      next,
      {
        text: 'Met someone new',
        date: SUN,
        category: 'social',
        energy: null,
        mood: null,
        goalId: null,
      },
      'l2',
      new Date(2026, 10, 30, 13).toISOString(),
    );
    expect(logFor(next, SUN).map((e) => e.text)).toEqual(['Good day overall', 'Met someone new']);
    next = saveLog(
      next,
      {
        text: 'Great day overall',
        date: SUN,
        category: 'general',
        energy: 3,
        mood: 4,
        goalId: null,
      },
      'x',
      '2026-11-15T20:00:00.000Z',
      'l1',
    );
    expect(next.lifeLog[0]).toMatchObject({ id: 'l1', at: AT, text: 'Great day overall' });
    expect(next.lifeLog[1].text).toBe('Met someone new');
    next = deleteLog(next, 'l2');
    expect(next.lifeLog.map((e) => e.id)).toEqual(['l1']);
    expect(dayProgress(next.days[SUN], next.programs, SUN)).toEqual(progress);
    expect(logFor(next, NEXT_SUN)).toEqual([]);
  });

  it('refuses a blank entry and an out-of-range rating', () => {
    expect(() =>
      saveLog(
        sunday(),
        { text: '   ', date: SUN, category: null, energy: null, mood: null, goalId: null },
        'l1',
        AT,
      ),
    ).toThrow(/few words/);
    expect(() =>
      saveLog(
        sunday(),
        { text: 'ok', date: SUN, category: null, energy: 6, mood: null, goalId: null },
        'l1',
        AT,
      ),
    ).toThrow();
  });
});

describe('backup and state compatibility', () => {
  function fullState(): State {
    let state = sunday();
    state = recordWeight(
      state,
      {
        value: 180.4,
        unit: 'lb',
        date: SUN,
        fasted: true,
        note: 'Synthetic',
        occurrence: { date: SUN, blockId: weighIn(state).id },
      },
      'w1',
      AT,
    );
    state = saveMoneyReview(
      state,
      { ...base, date: SUN, savings: 1000, nextAction: 'Synthetic action' },
      'r1',
      AT,
    );
    state = saveLog(
      state,
      {
        text: 'Synthetic note',
        date: SUN,
        category: 'reflection',
        energy: 2,
        mood: 3,
        goalId: 'vitality',
      },
      'l1',
      AT,
    );
    return state;
  }

  it('round-trips every new record type', () => {
    const state = fullState();
    const restored = parseBackup(encodeBackup(state, AT)).state;
    expect(restored).toEqual(state);
    expect(JSON.parse(encodeBackup(state, AT)).version).toBe(5);
  });

  it('restores a version-1 backup with empty records', () => {
    const v1 = JSON.parse(encodeBackup(trainingState(), AT));
    v1.version = 1;
    v1.state.version = 1;
    for (const key of [
      'measurements',
      'lifeLog',
      'workoutTemplates',
      'workoutSessions',
      'moneyReviews',
      'intervalRoutines',
      'intervalSessions',
      'activitySessions',
      'ruleBooks',
      'ruleReviews',
      'focuses',
      'weeklyReviews',
      'skillCheckpoints',
      'tradingSessions',
      'tradingSessionsImported',
    ])
      delete v1.state[key];
    for (const program of v1.state.programs)
      for (const routine of program.routines) delete routine.capture;
    const restored = parseBackup(JSON.stringify(v1)).state;
    expect(restored.version).toBe(5);
    expect(restored.measurements).toEqual([]);
    expect(restored.tradingSessions).toEqual({});
    expect(restored.programs.map((p) => p.id)).toEqual(['training', 'tracking']);
  });

  it('rejects a version-1 file that carries records, rather than guessing', () => {
    const v1 = JSON.parse(encodeBackup(fullState(), AT));
    v1.version = 1;
    v1.state.version = 1;
    expect(() => parseBackup(JSON.stringify(v1))).toThrow();
  });

  it('rejects duplicate IDs, bad units and impossible values before anything is replaced', () => {
    const good = JSON.parse(encodeBackup(fullState(), AT));
    const cases: ((s: Record<string, unknown[]>) => void)[] = [
      (s) => s.measurements.push({ ...(s.measurements[0] as object), date: '2026-11-01' }),
      (s) => ((s.measurements[0] as { entered: { unit: string } }).entered.unit = 'stone'),
      (s) => ((s.measurements[0] as { grams: number }).grams = 1),
      (s) => ((s.moneyReviews[0] as { savings: number }).savings = 10.5),
      (s) => ((s.moneyReviews[0] as { currency: string }).currency = 'usd'),
      (s) => ((s.lifeLog[0] as { mood: number }).mood = 9),
      (s) => s.lifeLog.push(s.lifeLog[0]),
      (s) => ((s.workoutTemplates[0] as { exercises: { sets: number }[] }).exercises[0].sets = 0),
      (s) => s.workoutTemplates.push({ ...(s.workoutTemplates[0] as object), id: 'other' }),
    ];
    for (const change of cases) {
      const copy = JSON.parse(JSON.stringify(good));
      change(copy.state);
      expect(() => parseBackup(JSON.stringify(copy))).toThrow();
    }
  });

  it('upgrades a version-1 state and refuses unknown versions', () => {
    const v1 = { ...JSON.parse(JSON.stringify(trainingState())), version: 1 };
    for (const key of [
      'measurements',
      'lifeLog',
      'workoutTemplates',
      'workoutSessions',
      'moneyReviews',
      'intervalRoutines',
      'intervalSessions',
      'activitySessions',
      'ruleBooks',
      'ruleReviews',
      'focuses',
      'weeklyReviews',
      'skillCheckpoints',
      'tradingSessions',
      'tradingSessionsImported',
    ])
      delete v1[key];
    for (const program of v1.programs)
      for (const routine of program.routines) delete routine.capture;
    expect(decodeState(v1).version).toBe(5);
    expect(() => decodeState({ ...trainingState(), version: 6 })).toThrow(/unsupported version/);
  });

  it('keeps a large synthetic history well under the backup limit', () => {
    let state = sunday();
    let date = '2024-01-07';
    for (let i = 0; i < 150; i++) {
      state = recordWeight(
        state,
        { value: 180 + (i % 5) / 10, unit: 'lb', date, fasted: null, note: '' },
        `w${i}`,
        AT,
      );
      state = saveMoneyReview(
        state,
        {
          ...base,
          date,
          savings: 100000 + i * 1000,
          debt: 500000 - i * 1000,
          nextAction: 'Synthetic',
        },
        `r${i}`,
        AT,
      );
      state = saveLog(
        state,
        {
          text: 'Synthetic entry '.repeat(10),
          date,
          category: 'general',
          energy: 3,
          mood: 3,
          goalId: null,
        },
        `l${i}`,
        AT,
      );
      date = new Date(Date.parse(`${date}T12:00:00`) + 7 * 86_400_000).toISOString().slice(0, 10);
    }
    const raw = encodeBackup(state, AT);
    expect(raw.length).toBeLessThan(1_000_000);
    expect(parseBackup(raw).state).toEqual(state);
  });
});

describe('record dates, decimal commas and rounding', () => {
  it('refuses a weight or a money review dated after the day it is recorded', () => {
    expect(() =>
      recordWeight(
        sunday(),
        { value: 180, unit: 'lb', date: SUN, fasted: null, note: '' },
        'w',
        OPENED,
      ),
    ).toThrow(/today or an earlier day/);
    expect(() => saveMoneyReview(sunday(), { ...base, date: SUN, cash: 1 }, 'r', OPENED)).toThrow(
      /today or an earlier day/,
    );
  });

  it('refuses ambiguous commas instead of reading 2,5 as 25', () => {
    expect(() => parseAmount('2,5')).toThrow(/thousands/);
    expect(parseAmount('12,345,678.90')).toBe(1234567890);
  });

  it('rounds weight changes the same way up and down', () => {
    let state = recordWeight(
      sunday(),
      { value: 180.25, unit: 'lb', date: '2026-11-01', fasted: null, note: '' },
      'a',
      AT,
    );
    state = recordWeight(
      state,
      { value: 180.7, unit: 'lb', date: '2026-11-08', fasted: null, note: '' },
      'b',
      AT,
    );
    state = recordWeight(
      state,
      { value: 180.25, unit: 'lb', date: SUN, fasted: null, note: '' },
      'c',
      AT,
    );
    expect(weightHistory(state, 'lb').map((p) => p.change)).toEqual([null, 0.5, -0.5]);
  });
});
