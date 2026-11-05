import { describe, expect, it } from '@jest/globals';
import { withDay } from '../data';
import { buildExport, encodeCsv, encodeJson, ExportOptions } from '../export';
import { recordWeight } from '../measurements';
import { saveMoneyReview } from '../money';
import { State } from '../model';
import { ensureChecklistDay, setStatus } from '../planner';
import { trainingState } from '../../test-support/fixtures';
import { demoState } from '../demo';
import { DEMO } from '../demo-catalog';

// Synthetic records only.
const noon = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
};

function state(): State {
  let s = trainingState();
  s = recordWeight(
    s,
    { value: 180.4, unit: 'lb', date: '2026-11-01', fasted: true, note: '' },
    'w1',
    noon('2026-11-01'),
  );
  s = recordWeight(
    s,
    { value: 179.8, unit: 'lb', date: '2026-11-08', fasted: null, note: '' },
    'w2',
    noon('2026-11-08'),
  );
  s = saveMoneyReview(
    s,
    {
      date: '2026-11-08',
      currency: 'USD',
      cash: 1250_50,
      savings: null,
      debt: 4000_00,
      upcoming: null,
      contributed: null,
      savingsTarget: null,
      nextAction: '',
      note: '',
      goalId: null,
    },
    'm1',
    noon('2026-11-08'),
  );
  s = {
    ...s,
    lifeLog: [
      {
        id: 'l1',
        date: '2026-11-08',
        at: noon('2026-11-08'),
        text: 'Synthetic note, with "quotes"',
        category: null,
        energy: 3,
        mood: null,
        goalId: null,
      },
    ],
  };
  // Sunday: a private weigh-in and a private money review are due.
  s = withDay(
    s,
    ensureChecklistDay('2026-11-08', s.settings, s.programs, undefined, noon('2026-11-08')),
  );
  s = withDay(
    s,
    setStatus(s.days['2026-11-08'], '2026-11-08:routine:money-check', 'done', noon('2026-11-08')),
  );
  return s;
}
const options = (patch: Partial<ExportOptions> = {}): ExportOptions => ({
  categories: ['weight', 'money', 'objectives'],
  from: null,
  to: '2026-11-30',
  includePrivate: false,
  ...patch,
});

describe('selective export', () => {
  it('exports only the chosen categories and dates, with units and explicit missing values', () => {
    const rows = buildExport(state(), options({ from: '2026-11-05' }));
    expect(rows.filter((r) => r.category === 'weight')).toEqual([
      {
        category: 'weight',
        date: '2026-11-08',
        item: 'body weight',
        field: 'weight',
        value: 179.8,
        unit: 'lb',
        note: 'fasted not recorded',
      },
      {
        category: 'weight',
        date: '2026-11-08',
        item: 'body weight',
        field: 'weight in kg',
        value: 81.6,
        unit: 'kg',
        note: 'converted',
      },
    ]);
    expect(rows.filter((r) => r.category === 'money')).toEqual([
      {
        category: 'money',
        date: '2026-11-08',
        item: 'money review',
        field: 'cash',
        value: 1250.5,
        unit: 'USD',
        note: '',
      },
      {
        category: 'money',
        date: '2026-11-08',
        item: 'money review',
        field: 'savings',
        value: null,
        unit: 'USD',
        note: 'not reported',
      },
      {
        category: 'money',
        date: '2026-11-08',
        item: 'money review',
        field: 'debt',
        value: 4000,
        unit: 'USD',
        note: '',
      },
    ]);
    expect(rows.some((r) => r.category === 'lifeLog')).toBe(false);
  });

  it('leaves private objectives out of adherence unless explicitly included', () => {
    const without = buildExport(state(), options()).filter((r) => r.category === 'objectives');
    expect(without.map((r) => `${r.item}:${r.value}`)).toEqual(['day:open']);
    const withPrivate = buildExport(state(), options({ includePrivate: true })).filter(
      (r) => r.category === 'objectives',
    );
    expect(withPrivate.map((r) => `${r.item}:${r.value}`).sort()).toEqual([
      'Money review:done',
      'Weekly weigh-in:planned',
      'day:open',
    ]);
  });

  it('writes JSON with its format, notes and range, and CSV with escaped cells', () => {
    const json = JSON.parse(
      encodeJson(state(), options({ categories: ['lifeLog'] }), noon('2026-11-30')),
    );
    expect(json).toMatchObject({
      format: 'life-os-analysis-export',
      version: 1,
      range: { from: null, to: '2026-11-30' },
      categories: ['lifeLog'],
    });
    expect(json.notes).toMatch(/not zero/);
    const csv = encodeCsv(state(), options({ categories: ['lifeLog'] }));
    expect(csv.split('\n')[0]).toBe('category,date,item,field,value,unit,note');
    expect(csv).toContain('lifeLog,2026-11-08,note,text,"Synthetic note, with ""quotes""",,');
    expect(csv).toContain('lifeLog,2026-11-08,note,mood,,1-5 self-report,not given');
  });

  it('writes text that a spreadsheet would read as a formula as plain text', () => {
    const withNote = (text: string): State => ({
      ...state(),
      lifeLog: [{ ...state().lifeLog[0], text }],
    });
    const noteCell = (text: string) =>
      encodeCsv(withNote(text), options({ categories: ['lifeLog'] }))
        .split('\n')
        .find((line) => line.includes(',note,text,'));
    expect(noteCell('=1+1')).toBe("lifeLog,2026-11-08,note,text,'=1+1,,");
    expect(noteCell('-5 minutes late')).toBe("lifeLog,2026-11-08,note,text,'-5 minutes late,,");
    // A leading tab or carriage return is also read as the start of a formula.
    expect(noteCell('\t=1+1')).toBe("lifeLog,2026-11-08,note,text,'\t=1+1,,");
    expect(noteCell('\r=1+1')).toBe('lifeLog,2026-11-08,note,text,"\'\r=1+1",,');
    expect(noteCell('Plain note')).toBe('lifeLog,2026-11-08,note,text,Plain note,,');
  });
});

describe('private routines in exercise progress and rule reviews', () => {
  // The fictional demo: its trading routine is private; its first chest workout is made private here.
  const demo = demoState('2026-11-09');
  const privatePush: State = {
    ...demo,
    programs: demo.programs.map((p) => ({
      ...p,
      routines: p.routines.map((r) => (r.id === DEMO.chestA ? { ...r, private: true } : r)),
    })),
  };
  const run = (s: State, category: 'strength' | 'ruleReviews', includePrivate: boolean) =>
    buildExport(s, { categories: [category], from: null, to: '2026-11-09', includePrivate });

  it("leaves a private routine's workouts out of exercise progress unless included", () => {
    const benchDates = (rows: { item: string; date: string }[]) =>
      rows.filter((r) => r.item === 'Bench press').map((r) => r.date);
    expect(benchDates(run(demo, 'strength', false)).length).toBeGreaterThan(0);
    expect(benchDates(run(privatePush, 'strength', false))).toEqual([]);
    expect(benchDates(run(privatePush, 'strength', true))).toEqual(
      benchDates(run(demo, 'strength', false)),
    );
    // Other exercises are untouched.
    expect(run(privatePush, 'strength', false).some((r) => r.item === 'Back squat')).toBe(true);
  });

  it("leaves a private routine's rule reviews out unless included", () => {
    expect(run(demo, 'ruleReviews', false)).toEqual([]);
    expect(run(demo, 'ruleReviews', true).length).toBeGreaterThan(0);
  });
});
