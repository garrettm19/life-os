import { describe, expect, it } from '@jest/globals';
import { encodeBackup, parseBackup } from '../backup';
import { decodeState } from '../data';
import { Focus, SkillCheckpoint, State, WeeklyReview } from '../model';
import { restorePreview } from '../restore-preview';
import { trainingState } from '../../test-support/fixtures';

// Synthetic records only.
const AT = new Date(2026, 10, 9, 12).toISOString();

const focus = (extra: Partial<Focus> = {}): Focus => ({
  id: 'f1',
  title: 'Interview readiness',
  goalId: null,
  outcome: 'Solve new medium problems under time',
  evidence: 'career',
  routineIds: ['upper'],
  leadRoutineId: null,
  cue: '',
  baseline: '',
  target: '',
  startDate: '2026-11-09',
  reviewDate: '2027-02-07',
  status: 'active',
  endedAt: null,
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});
const review = (extra: Partial<WeeklyReview> = {}): WeeklyReview => ({
  id: 'week-2026-11-09',
  weekStart: '2026-11-09',
  focusId: 'f1',
  obstacle: '',
  adjustment: 'Study before dinner',
  noChange: false,
  at: AT,
  updatedAt: AT,
  ...extra,
});
const checkpoint = (extra: Partial<SkillCheckpoint> = {}): SkillCheckpoint => ({
  id: 'k1',
  date: '2026-11-09',
  at: AT,
  method: 'Unseen problems',
  difficulty: 'medium',
  attempted: 4,
  solved: 2,
  minutes: 60,
  fresh: true,
  topics: '',
  next: '',
  ...extra,
});
const withRecords = (extra: Partial<State>): State => ({
  ...trainingState(),
  focuses: [focus()],
  weeklyReviews: [review()],
  skillCheckpoints: [checkpoint()],
  ...extra,
});
const decode = (s: State) => decodeState(JSON.parse(JSON.stringify(s)));

describe('version-4 records', () => {
  it('decode and round-trip through a backup', () => {
    const state = withRecords({});
    expect(decode(state)).toEqual(state);
    expect(parseBackup(encodeBackup(state, AT)).state).toEqual(state);
  });

  it('refuse a second active focus, a lead outside the routines and a review before the start', () => {
    const bad: Partial<State>[] = [
      { focuses: [focus(), focus({ id: 'f2' })] },
      { focuses: [focus({ leadRoutineId: 'lower' })] },
      { focuses: [focus({ reviewDate: '2026-11-01' })] },
      { focuses: [focus({ status: 'archived', endedAt: null })] },
      { focuses: [focus({ endedAt: AT })] },
      { focuses: [focus({ routineIds: ['upper', 'upper'] })] },
      { focuses: [focus({ title: ' ' })] },
    ];
    for (const extra of bad) expect(() => decode(withRecords(extra))).toThrow();
    // Several finished focus periods beside one active are fine.
    expect(() =>
      decode(
        withRecords({
          focuses: [focus(), focus({ id: 'f0', status: 'completed', endedAt: AT })],
        }),
      ),
    ).not.toThrow();
  });

  it('refuse a weekly review not on a Monday, two for one week, or no change with a change', () => {
    const bad: Partial<State>[] = [
      { weeklyReviews: [review({ weekStart: '2026-11-10' })] },
      { weeklyReviews: [review(), review({ id: 'other' })] },
      { weeklyReviews: [review({ noChange: true })] },
    ];
    for (const extra of bad) expect(() => decode(withRecords(extra))).toThrow();
  });

  it('refuse impossible checkpoints', () => {
    const bad: Partial<State>[] = [
      { skillCheckpoints: [checkpoint({ solved: 5 })] },
      { skillCheckpoints: [checkpoint({ attempted: 0, solved: 0 })] },
      { skillCheckpoints: [checkpoint({ difficulty: 'expert' as never })] },
      { skillCheckpoints: [checkpoint({ minutes: 0 })] },
      { skillCheckpoints: [checkpoint({ method: '' })] },
    ];
    for (const extra of bad) expect(() => decode(withRecords(extra))).toThrow();
  });

  it('upgrades a version-3 backup with the new lists empty, and refuses one carrying them', () => {
    const raw = JSON.parse(encodeBackup(trainingState(), AT));
    raw.version = 3;
    raw.state.version = 3;
    for (const key of [
      'focuses',
      'weeklyReviews',
      'skillCheckpoints',
      'tradingSessions',
      'tradingSessionsImported',
    ])
      delete raw.state[key];
    const restored = parseBackup(JSON.stringify(raw));
    expect(restored.sourceVersion).toBe(3);
    expect(restored.state.version).toBe(5);
    expect(restored.state.focuses).toEqual([]);
    expect(restored.state.measurements).toEqual(trainingState().measurements);
    raw.state.focuses = [focus()];
    expect(() => parseBackup(JSON.stringify(raw))).toThrow();
  });

  it('lists focus periods, weekly reviews and checkpoints a restore would remove', () => {
    expect(restorePreview(withRecords({}), trainingState()).changes).toEqual([
      { label: 'focus periods', current: 1, added: 0, removed: 1, replaced: 0 },
      { label: 'weekly reviews', current: 1, added: 0, removed: 1, replaced: 0 },
      { label: 'skill checkpoints', current: 1, added: 0, removed: 1, replaced: 0 },
    ]);
  });
});
