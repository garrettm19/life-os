import { describe, expect, it } from '@jest/globals';
import { demoRuleBook } from '../demo-catalog';
import { decodeTradingSession, directional, newSession, setBias } from '../trading';
import { CORE_RULES, DAILY_RULES, ENTRY_COUNT_RULE, RISK_PRINCIPLES } from '../trading-rules';

// Synthetic session data only: no account, broker or market data.
const DAY = '2026-10-20';
const AT = '2026-10-19T22:30:00.000Z';
const LATER = '2026-10-20T14:00:00.000Z';

describe('daily candle bias', () => {
  it('bullish or bearish prepares the day; unclear does not', () => {
    const bull = setBias(newSession(DAY), 'bullish', AT);
    expect(bull).toMatchObject({ bias: 'bullish', biasAt: AT, preparedAt: AT });
    const unclear = setBias(bull, 'unclear', LATER);
    expect(unclear).toMatchObject({ bias: 'unclear', preparedAt: null });
    expect(directional('bearish')).toBe(true);
    expect(directional('unclear')).toBe(false);
    expect(directional(null)).toBe(false);
  });

  it('can change before the session starts, then stays as set', () => {
    const bear = setBias(setBias(newSession(DAY), 'bullish', AT), 'bearish', LATER);
    expect(bear).toMatchObject({ bias: 'bearish', preparedAt: AT });
    // Choosing the same bias again changes nothing.
    expect(setBias(bear, 'bearish', LATER)).toBe(bear);
    const started = { ...bear, startedAt: LATER };
    expect(() => setBias(started, 'bullish', LATER)).toThrow('stays as set');
    const noTrade = { ...bear, doneAt: LATER, doneReason: 'no-trade' as const };
    expect(() => setBias(noTrade, 'bullish', LATER)).toThrow('done');
    // A saved review ends trading for the candle: the bias stays as set.
    expect(() => setBias(bear, 'bullish', LATER, true)).toThrow('reviewed');
    expect(setBias(bear, 'bearish', LATER, true)).toBe(bear);
  });

  it('reads back the bias, keeps days saved before it, and drops old plans', () => {
    const saved = JSON.parse(JSON.stringify(setBias(newSession(DAY), 'bearish', AT)));
    expect(decodeTradingSession(saved)).toEqual(saved);
    expect(decodeTradingSession(newSession(DAY))).toEqual(newSession(DAY));
    // A day from an earlier build, with pre-trade plans: the day is kept, the plans are not.
    const older = { ...newSession(DAY), failedTheses: 1, plans: [{ id: 'x', state: 'locked' }] };
    expect(decodeTradingSession(older)).toEqual({ ...newSession(DAY), failedTheses: 1 });
    expect(decodeTradingSession({ ...saved, bias: 'sideways' })).toBeNull();
    expect(decodeTradingSession({ ...saved, biasAt: 'soon' })).toBeNull();
  });
});

describe('daily trading rules', () => {
  it('are the fifteen rules in order, and the demo rulebook carries them', () => {
    expect(DAILY_RULES.map((r) => r.n)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(DAILY_RULES.every((r) => r.title && r.lines.length)).toBe(true);
    expect(CORE_RULES).toContain('If nothing is there, do nothing');
    const book = demoRuleBook(DAY, AT);
    expect(book.rules.map((r) => r.id)).toEqual(DAILY_RULES.map((r) => `rule-${r.n}`));
    expect(book.rules[6].title).toBe('Entry requires a named setup and every confirmation');
    // Rule 7 asks each condition the cockpit's entry needs: the bias, the named setup, the GEX
    // area, current GEX, the LTF confirmation, not chasing, and the invalidation within limits.
    expect(DAILY_RULES[6].lines[0].match(/\?/g)).toHaveLength(7);
    // The core rule is said once on the board, the daily rules included.
    const board = [...CORE_RULES, ...DAILY_RULES.flatMap((r) => [r.title, ...r.lines])].join('\n');
    expect(board.match(/HTF chooses direction/gi)).toHaveLength(1);
    expect(DAILY_RULES[12]).toEqual({
      n: 13,
      title: 'Adds are planned before the first entry',
      lines: [
        'Any add location must be planned before the first entry. Do not invent an add from LTF movement after entry.',
        'Every add counts as an entry.',
        'Never add simply because “I think it will come back.” Never use adding to rescue a bad entry.',
      ],
    });
    // The new core rule closes the red group, after "If nothing is there, do nothing".
    expect(CORE_RULES.slice(-2)).toEqual(['If nothing is there, do nothing', 'Chop = leave it']);
    expect(RISK_PRINCIPLES[0]).toBe(ENTRY_COUNT_RULE);
    // The demo's example limit is two entries, as its written limits say.
    expect(book.trading!.maxEntries).toBe(2);
  });
});
