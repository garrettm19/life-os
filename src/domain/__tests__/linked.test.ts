import { describe, expect, test } from '@jest/globals';
import { type RecordKind, linkedRecord, recordKind } from '../linked';
import { Block, Routine, State, emptyState } from '../model';
import { DSA_STUDY, copyStudyPlan } from '../study';
import { defaultTradingProfile } from '../trading';
import { oneTap } from '../widget-list';

// Synthetic objectives only: one of each kind of record, with invented titles.
const DATE = '2026-11-09';

const routine = (id: string, extra: Partial<Routine> = {}): Routine => ({
  id,
  title: `Routine ${id}`,
  duration: null,
  weekdays: [1, 2, 3, 4, 5],
  preferredStart: null,
  enabled: true,
  fixed: false,
  steps: [],
  bundledInto: null,
  checklist: true,
  ...extra,
});

const block = (routineId: string | null): Block => ({
  id: `occurrence-${routineId ?? 'plain'}`,
  routineId,
  programId: routineId ? 'p' : null,
  title: 'Example objective',
  start: null,
  duration: null,
  fixed: false,
  status: 'done',
  actualAt: null,
  steps: [],
  reason: null,
  checklist: true,
});

function everyKind(): State {
  const s = emptyState();
  s.programs = [
    {
      id: 'p',
      title: 'Example',
      group: 'Example',
      goalIds: [],
      routines: [
        routine('walk'),
        routine('lift'),
        routine('circuit'),
        routine('study', { study: copyStudyPlan(DSA_STUDY) }),
        routine('weigh', { capture: 'weight' }),
        routine('budget', { capture: 'money' }),
        routine('cardio', { capture: 'activity' }),
        routine('rules', { capture: 'rules' }),
        routine('trade', { capture: 'rules' }),
      ],
    },
  ];
  s.workoutTemplates = [{ routineId: 'lift' } as State['workoutTemplates'][number]];
  s.intervalRoutines = [{ routineId: 'circuit' } as State['intervalRoutines'][number]];
  s.ruleBooks = [
    { id: 'book-rules', routineId: 'rules' } as State['ruleBooks'][number],
    {
      id: 'book-trade',
      routineId: 'trade',
      trading: defaultTradingProfile(DATE),
    } as State['ruleBooks'][number],
  ];
  return s;
}

const KINDS: [string | null, RecordKind | null][] = [
  [null, null],
  ['walk', null],
  ['lift', 'workout'],
  ['circuit', 'circuit'],
  ['study', 'study'],
  ['weigh', 'weight'],
  ['budget', 'money'],
  ['cardio', 'activity'],
  ['rules', 'rules'],
  // A trading rulebook makes its objective a trading session, whatever the routine captures.
  ['trade', 'trading'],
];

describe('what an objective records', () => {
  test('is decided in one place', () => {
    const s = everyKind();
    for (const [id, kind] of KINDS) expect([id, recordKind(s, block(id))]).toEqual([id, kind]);
  });

  test('the widget ticks only what Today completes with one tap: a plain or study objective', () => {
    const s = everyKind();
    for (const [id, kind] of KINDS)
      expect([id, oneTap(s, block(id))]).toEqual([id, kind === null || kind === 'study']);
  });

  test('every kind but plain and study is missing its record until one exists', () => {
    const s = everyKind();
    for (const [id, kind] of KINDS)
      expect([id, linkedRecord(s, block(id), DATE)]).toEqual([
        id,
        kind === null || kind === 'study' ? null : 'missing',
      ]);
    // A trading session is recorded as a rule review of its occurrence.
    s.ruleReviews = [
      {
        id: 'review',
        date: DATE,
        at: new Date(2026, 10, 9, 16).toISOString(),
        routineId: 'trade',
        occurrenceId: block('trade').id,
        outcome: 'reviewed',
        answers: [],
        violations: [],
        note: '',
      },
    ];
    expect(linkedRecord(s, block('trade'), DATE)).toBe('recorded');
    expect(linkedRecord(s, block('rules'), DATE)).toBe('missing');
  });
});
