import { describe, expect, it, jest } from '@jest/globals';
import { createElement } from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { BIAS_STRIP, BiasStrip, biasStrip } from '../bias-strip';
import { ThesisCardView } from '../trading-thesis';

function render(element: ReturnType<typeof createElement>): ReactTestRenderer {
  let tree: ReactTestRenderer | null = null;
  act(() => {
    tree = create(element);
  });
  return tree!;
}

describe('bias strip', () => {
  it('shows each daily bias as one line and reads it as one sentence', () => {
    const cases = [
      ['bullish', '▲ Bullish day · longs only', 'Daily bias: bullish. Longs only.'],
      ['bearish', '▼ Bearish day · shorts only', 'Daily bias: bearish. Shorts only.'],
      ['unclear', '? Unclear · no trade today', 'Daily bias: unclear. No trade today.'],
    ] as const;
    for (const [bias, text, spoken] of cases) {
      const tree = render(createElement(BiasStrip, { bias }));
      expect(tree.root.findByType(Text).props.children).toBe(text);
      const strip = tree.root.findAllByProps({ testID: 'bias-strip' })[0];
      expect(strip.props.accessibilityLabel).toBe(spoken);
      expect(strip.props.accessibilityRole).toBeUndefined();
    }
  });

  it("has a compact form for the caption of Today's trading row", () => {
    expect(BIAS_STRIP.bullish.short).toBe('▲ Bullish · longs only');
    expect(BIAS_STRIP.bearish.short).toBe('▼ Bearish · shorts only');
    expect(BIAS_STRIP.unclear.short).toBe('? Unclear · no trade today');
    expect(BIAS_STRIP.none.short).toBe("Set today's daily bias");
  });

  it('asks for the bias in amber, as a button where it can open the board', () => {
    expect(BIAS_STRIP.none.text).toBe("Set today's daily bias");
    const onPress = jest.fn();
    const tree = render(createElement(BiasStrip, { bias: null, onPress, size: 'compact' }));
    const button = tree.root.findAllByProps({ testID: 'bias-strip' })[0];
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe("Daily bias not set. Set today's daily bias.");
    act(() => button.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("names a later candle, so its bias is never read as the day's own", () => {
    expect(biasStrip(null, '2026-11-10')).toMatchObject({
      text: 'Set the bias for Tue, Nov 10',
      short: 'Set the bias for Tue, Nov 10',
      spoken: 'Daily bias for Tue, Nov 10 not set. Set the bias for Tue, Nov 10.',
    });
    expect(biasStrip('bearish', '2026-11-10')).toMatchObject({
      text: '▼ Bearish day · shorts only',
      short: 'For Tue, Nov 10 · ▼ Bearish · shorts only',
      spoken: 'Daily candle of Tue, Nov 10. Daily bias: bearish. Shorts only.',
    });
    expect(biasStrip('bullish', null)).toBe(BIAS_STRIP.bullish);
    const tree = render(createElement(BiasStrip, { bias: null, candle: '2026-11-10' }));
    expect(tree.root.findByType(Text).props.children).toBe('Set the bias for Tue, Nov 10');
  });

  it('keeps its words and a thesis direction in sentence case: uppercase is only a style', () => {
    for (const strip of [...Object.values(BIAS_STRIP), biasStrip(null, '2026-11-10')])
      expect(strip.text).not.toBe(strip.text.toUpperCase());
    const thesis = {
      direction: 'long' as const,
      expectation: 'Expansion up',
      gexReason: 'Above the line',
      objective: 'Prior high',
      zone: 'Pullback to the line',
      invalidation: 'Close under the low',
      addPlan: null,
      committedAt: new Date(2026, 10, 9, 9, 40).toISOString(),
    };
    const tree = render(createElement(ThesisCardView, { thesis }));
    const words = tree.root.findAllByType(Text).flatMap((t) => [t.props.children].flat());
    expect(words).toContain('Long');
    expect(words).not.toContain('LONG');
  });
});
