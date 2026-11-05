import type { Program, State } from '../../src/domain/model';
import { studyState } from '../../src/test-support/fixtures';
import { defaultTradingProfile } from '../../src/domain/trading';

// Synthetic only: a generic trading routine with invented limits. No real account, instrument
// size or amount appears here.
export const TRADING_ROUTINE = 'trade-rules';

export function tradingProgram(): Program {
  return {
    id: 'trading',
    title: 'Trading discipline',
    group: 'Private',
    goalIds: [],
    routines: [
      {
        id: TRADING_ROUTINE,
        title: 'Follow my trading rules',
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
}

/** Adds a trading rulebook; with a `since` date, also the Trading discipline profile from then. */
export function withTradingBook(state: State, since: string | null): State {
  return {
    ...state,
    programs: [...state.programs, tradingProgram()],
    ruleBooks: [
      ...state.ruleBooks,
      {
        id: 'book-trading',
        routineId: TRADING_ROUTINE,
        title: 'Trading rules',
        checkpoints: [{ id: 'checkpoint-1', text: 'An earlier checkpoint' }],
        rules: [{ id: 'rule-1', title: 'An earlier rule', details: '' }],
        updatedAt: '2026-10-01T12:00:00.000Z',
        ...(since
          ? {
              trading: {
                ...defaultTradingProfile(since),
                maxFailedTheses: 2,
                limits: [
                  { id: 'limit-1', label: 'Thesis risk', value: '$40 per account' },
                  {
                    id: 'limit-2',
                    label: 'Daily loss',
                    value: '−$80 per account · done for the day',
                  },
                  { id: 'limit-3', label: 'Entries', value: '3 per day' },
                ],
              },
            }
          : {}),
      },
    ],
  };
}

export function tradingState(since: string | null = '2026-11-02'): State {
  return withTradingBook(studyState(), since);
}
