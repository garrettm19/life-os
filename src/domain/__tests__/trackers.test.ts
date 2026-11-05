import { describe, expect, it } from '@jest/globals';
import { parseMinutes, recordActivity, weeklyMinutes } from '../activity';
import { encodeBackup, parseBackup } from '../backup';
import { decodeState, withDay } from '../data';
import { linkedRecord } from '../linked';
import { Block, Program, RuleBook, State } from '../model';
import { dayOutcome } from '../objectives';
import {
  adherence,
  fullyCompliant,
  parseCheckpoints,
  parseRules,
  rulesText,
  saveRuleBook,
  saveRuleReview,
} from '../rules';
import { trainingState } from '../../test-support/fixtures';

// Synthetic routines: a cardio objective that records an activity, and a generic rule review.
// The rules below are invented examples, not anyone's real rulebook.
const MON = '2026-11-09';
const noon = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
};

function state(): State {
  const base = trainingState();
  const tracking: Program = {
    id: 'trackers',
    title: 'Trackers',
    group: 'Daily',
    goalIds: [],
    routines: [
      {
        id: 'cardio',
        title: 'Cardio',
        duration: 30,
        weekdays: [1, 3, 5],
        preferredStart: null,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
        checklist: true,
        capture: 'activity',
        activities: ['Bike', 'Stairs', 'Other'],
      },
      {
        id: 'rules',
        title: 'Follow my rules',
        duration: null,
        weekdays: [1, 2, 3, 4, 5],
        preferredStart: null,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
        checklist: true,
        private: true,
        capture: 'rules',
      },
    ],
  };
  return { ...base, programs: [...base.programs, tracking] };
}

function block(date: string, routineId: string): Block {
  return {
    id: `${date}:routine:${routineId}`,
    routineId,
    programId: 'trackers',
    title: routineId,
    start: null,
    duration: null,
    fixed: false,
    status: 'planned',
    actualAt: null,
    steps: [],
    reason: null,
    checklist: true,
  };
}

const RULES = `1. Plan before acting
- Write the plan first.

2. Stop at the limit
Stop for the day at the limit.
3) Review afterwards`;

function withBook(s: State): State {
  const book: RuleBook = {
    id: 'book',
    routineId: 'rules',
    title: 'My rules',
    checkpoints: parseCheckpoints('1. Planned first\n2. Respected the limit\n\n3. Reviewed'),
    rules: parseRules(RULES),
    updatedAt: noon(MON),
  };
  return saveRuleBook(s, book);
}

describe('duration activities', () => {
  it('records what and how long, and completes the objective in one change', () => {
    let s = withDay(state(), { date: MON, revisions: [], blocks: [block(MON, 'cardio')] });
    s = recordActivity(
      s,
      {
        date: MON,
        activity: 'Bike',
        minutes: parseMinutes('32'),
        note: '',
        routineId: 'cardio',
        occurrence: { date: MON, blockId: block(MON, 'cardio').id },
      },
      'a1',
      noon(MON),
    );
    expect(s.days[MON].blocks[0].status).toBe('done');
    expect(linkedRecord(s, s.days[MON].blocks[0])).toBe('recorded');
    expect(() =>
      recordActivity(
        s,
        {
          date: MON,
          activity: 'Bike',
          minutes: 10,
          note: '',
          routineId: 'cardio',
          occurrence: { date: MON, blockId: block(MON, 'cardio').id },
        },
        'a2',
        noon(MON),
      ),
    ).toThrow(/already has an activity/);
    expect(weeklyMinutes(s, MON, 2)).toEqual([
      { weekStart: '2026-11-02', minutes: 0, sessions: 0 },
      { weekStart: MON, minutes: 32, sessions: 1 },
    ]);
    expect(() => parseMinutes('0')).toThrow();
    expect(() => parseMinutes('1.5')).toThrow();
  });
});

describe('rule-adherence reviews', () => {
  it('reads a pasted numbered rulebook, keeping rule numbers as identities', () => {
    const rules = parseRules(RULES);
    expect(rules).toEqual([
      { id: 'rule-1', title: 'Plan before acting', details: '- Write the plan first.' },
      { id: 'rule-2', title: 'Stop at the limit', details: 'Stop for the day at the limit.' },
      { id: 'rule-3', title: 'Review afterwards', details: '' },
    ]);
    expect(parseRules(rulesText(rules))).toEqual(rules);
    expect(parseCheckpoints('a\n\nb').map((c) => c.text)).toEqual(['a', 'b']);
  });

  it('requires every checkpoint, and a day without the activity is its own outcome', () => {
    let s = withDay(withBook(state()), {
      date: MON,
      revisions: [],
      blocks: [block(MON, 'rules')],
    });
    const occurrence = { date: MON, blockId: block(MON, 'rules').id };
    expect(() =>
      saveRuleReview(
        s,
        {
          date: MON,
          routineId: 'rules',
          outcome: 'reviewed',
          answers: [{ checkpointId: 'checkpoint-1', answer: 'yes' }],
          violations: [],
          note: '',
          occurrence,
        },
        'r1',
        noon(MON),
      ),
    ).toThrow(/every checkpoint/);
    s = saveRuleReview(
      s,
      {
        date: MON,
        routineId: 'rules',
        outcome: 'none',
        answers: [],
        violations: [],
        note: '',
        occurrence,
      },
      'r1',
      noon(MON),
    );
    expect(s.days[MON].blocks[0].status).toBe('done');
    expect(dayOutcome(s, MON)).toBe('cleared');
    const result = adherence(s, 'rules', MON, MON);
    // Not a perfect score: nothing was evaluated.
    expect(result).toEqual({
      reviewed: 0,
      daysWithout: 1,
      compliantDays: 0,
      percent: null,
      missed: [],
    });
  });

  it('counts only applicable answers, never treats N/A as failure, and lists what was missed', () => {
    let s = withBook(state());
    const review = (
      date: string,
      answers: ('yes' | 'no' | 'na')[],
      violations: string[],
      id: string,
    ) => {
      s = saveRuleReview(
        s,
        {
          date,
          routineId: 'rules',
          outcome: 'reviewed',
          answers: answers.map((answer, i) => ({ checkpointId: `checkpoint-${i + 1}`, answer })),
          violations,
          note: '',
        },
        id,
        noon(date),
      );
    };
    review(MON, ['yes', 'yes', 'na'], [], 'a');
    // All checkpoints look fine, but a full rule was broken: not fully compliant.
    review('2026-11-10', ['yes', 'yes', 'yes'], ['rule-2'], 'b');
    review('2026-11-11', ['yes', 'no', 'na'], [], 'c');
    const result = adherence(s, 'rules', MON, '2026-11-11');
    expect(result.reviewed).toBe(3);
    expect(result.compliantDays).toBe(1);
    // 6 yes of 7 applicable answers.
    expect(result.percent).toBe(86);
    expect(result.missed).toEqual([
      { label: 'Respected the limit', count: 1 },
      { label: 'Stop at the limit', count: 1 },
    ]);
    expect(fullyCompliant(s.ruleReviews.find((r) => r.id === 'b')!)).toBe(false);
  });

  it('round-trips through a backup and rejects a scored day without the activity', () => {
    let s = withBook(state());
    s = saveRuleReview(
      s,
      {
        date: MON,
        routineId: 'rules',
        outcome: 'none',
        answers: [],
        violations: [],
        note: '',
      },
      'r1',
      noon(MON),
    );
    expect(parseBackup(encodeBackup(s, noon(MON))).state).toEqual(s);
    const bad = JSON.parse(JSON.stringify(s));
    bad.ruleReviews[0].answers = [{ checkpointId: 'checkpoint-1', answer: 'yes' }];
    expect(() => decodeState(bad)).toThrow();
  });
});
