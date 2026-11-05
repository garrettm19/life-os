import { describe, expect, it } from '@jest/globals';
import { tradingBook } from '../trading';
import {
  CISD_CHOICES,
  DEFAULT_STRATEGY_STEPS,
  defaultStrategy,
  retakeRuleSet,
  saveStrategy,
  strategyOf,
} from '../trading-strategy';
import { PRE, ROUTINE, liveState } from '../../test-support/trading-live';

// My Trading Strategy: the reference text kept on the trading profile. It starts from a generic
// template for the trader to rewrite.

describe('My Trading Strategy', () => {
  it('starts with the five template steps, an empty Key and no retake rule', () => {
    const profile = tradingBook(liveState())!.trading!;
    expect(profile.strategy).toBeUndefined();
    const strategy = strategyOf(profile);
    expect(strategy.steps).toHaveLength(5);
    expect(strategy.steps).toEqual(DEFAULT_STRATEGY_STEPS);
    expect(strategy.steps.map((s) => s.title)).toContain('Name your setups');
    expect(strategy.key).toBe('');
    expect(strategy.retakeRule).toBeNull();
    expect(retakeRuleSet(profile)).toBe(false);
    // The defaults name no account, instrument or amount.
    expect(JSON.stringify(strategy)).not.toMatch(/\$\d|MNQ|NQ\b/);
  });

  it('saves the wording trimmed; a blank retake rule is none', () => {
    const s = saveStrategy(
      liveState(),
      ROUTINE,
      {
        steps: [{ title: ' Wait ', summary: ' For the area ', detail: '' }],
        key: ' My notes ',
        retakeRule: '   ',
      },
      PRE,
    );
    const profile = tradingBook(s)!.trading!;
    expect(profile.strategy).toEqual({
      steps: [{ title: 'Wait', summary: 'For the area', detail: '' }],
      key: 'My notes',
      retakeRule: null,
    });
    const rule = saveStrategy(
      s,
      ROUTINE,
      { ...strategyOf(profile), retakeRule: 'A 5m body back above' },
      PRE,
    );
    expect(retakeRuleSet(tradingBook(rule)!.trading!)).toBe(true);
  });

  it('refuses a card without a title or wording past its length', () => {
    const steps = defaultStrategy().steps;
    expect(() =>
      saveStrategy(
        liveState(),
        ROUTINE,
        { ...defaultStrategy(), steps: [{ ...steps[0], title: ' ' }] },
        PRE,
      ),
    ).toThrow('Give every card a title, and keep the wording within its length.');
    expect(() =>
      saveStrategy(liveState(), ROUTINE, { ...defaultStrategy(), key: 'x'.repeat(8_001) }, PRE),
    ).toThrow(/within its length/);
  });

  it('marks a single wick as never enough for a CISD', () => {
    expect(CISD_CHOICES.filter((c) => !c.enough).map((c) => c.id)).toEqual(['single-wick']);
  });
});
