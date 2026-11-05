import { describe, expect, it } from '@jest/globals';
import { TINT_CAPTION } from '../bias-strip';
import { fonts, market, palette, themeCss, tokens, type } from '../theme';

// WCAG 2.2 relative luminance and contrast ratio for #RRGGBB colors (a translucent #RRGGBBAA color
// is first laid over the background it sits on).
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A translucent color laid over an opaque one. */
function over(top: string, bottom: string): string {
  const alpha = top.length === 9 ? parseInt(top.slice(7, 9), 16) / 255 : 1;
  const channel = (i: number) =>
    Math.round(
      parseInt(top.slice(i, i + 2), 16) * alpha +
        parseInt(bottom.slice(i, i + 2), 16) * (1 - alpha),
    )
      .toString(16)
      .padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/** Every pair below its minimum, as "fg on bg ratio", so a failure names itself. */
function failures(t: Record<string, string>, pairs: [string, string][], min: number): string[] {
  return pairs
    .map(([fg, bg]) => [fg, bg, contrast(t[fg], t[bg])] as const)
    .filter(([, , ratio]) => ratio < min)
    .map(([fg, bg, ratio]) => `${fg} on ${bg} ${ratio.toFixed(2)}`);
}

const cross = (fgs: string[], bgs: string[]) =>
  fgs.flatMap((fg) => bgs.map((bg) => [fg, bg] as [string, string]));

describe.each(['light', 'dark'] as const)('%s appearance contrast', (appearance) => {
  const t = tokens[appearance];

  it('keeps every text color at 4.5:1 on the page, cards and control fills', () => {
    expect(
      failures(
        t,
        [
          ...cross(['label', 'label2', 'label3'], ['canvas', 'surface', 'fill']),
          ...cross(['label', 'label2'], ['raised']),
        ],
        4.5,
      ),
    ).toEqual([]);
  });

  it('keeps text and captions at 4.5:1 on every tint they sit on', () => {
    const tints = ['accentTint', 'doneTint', 'dangerTint', 'bullTint', 'bearTint', 'gexTint'];
    expect(failures(t, cross(['label', 'label2', 'label3'], [...tints, 'amberTint']), 4.5)).toEqual(
      [],
    );
  });

  it('keeps Ember, Fern and the danger color readable as text on the page, cards and tints', () => {
    expect(
      failures(
        t,
        [
          ...cross(['accentText', 'doneText', 'danger'], ['canvas', 'surface']),
          ['accentText', 'accentTint'],
          ['doneText', 'doneTint'],
          ['danger', 'dangerTint'],
        ],
        4.5,
      ),
    ).toEqual([]);
  });

  it('keeps the ink on every filled button at 4.5:1', () => {
    expect(
      failures(
        t,
        [
          ['onLabel', 'label'],
          ['onDone', 'done'],
        ],
        4.5,
      ),
    ).toEqual([]);
  });

  it('keeps the open check outline at 3:1 on every ground a check sits on, the active row too', () => {
    expect(
      failures(t, cross(['checkEdge'], ['canvas', 'surface', 'fill', 'accentTint']), 3),
    ).toEqual([]);
  });

  it('keeps Ember and Fern themselves at 4.5:1 on the page, cards and their tint, as marks or text', () => {
    expect(
      failures(
        t,
        [
          ...cross(['accent', 'done'], ['canvas', 'surface']),
          ['accent', 'accentTint'],
          ['done', 'doneTint'],
        ],
        4.5,
      ),
    ).toEqual([]);
  });

  it("keeps the cockpit's market colors at 4.5:1 on the page, cards and their own tint", () => {
    const pairs = (['bull', 'bear', 'gex', 'amber'] as const).flatMap((c) => [
      [c, 'canvas'],
      [c, 'surface'],
      [c, `${c}Tint`],
    ]) as [string, string][];
    expect(failures(t, pairs, 4.5)).toEqual([]);
    // A chosen bias is its tint inside a ring in its color, the word in that color on the tint
    // (the pairs above); the HTF tile is the same.
    // I FEEL RUSHED's ring.
    expect(failures(t, cross(['amberEdge'], ['canvas', 'surface']), 3)).toEqual([]);
  });

  it("keeps the status band's dark ink at 4.5:1 on every family's solid fill", () => {
    expect(
      failures(t, cross(['onBand'], ['bandWait', 'bandPosition', 'bandStop', 'bandReady']), 4.5),
    ).toEqual([]);
    // The symbol's disc is decoration under the ink: laid over each fill, the ink still reads.
    for (const fill of ['bandWait', 'bandPosition', 'bandStop', 'bandReady'] as const)
      expect(contrast(t.onBand, over(t.bandMark, t[fill]))).toBeGreaterThanOrEqual(4.5);
    // The four families stay apart from each other and from the page they sit on.
    const fills = [t.bandWait, t.bandPosition, t.bandStop, t.bandReady];
    expect(new Set(fills).size).toBe(4);
    for (const fill of fills) expect(fill).not.toBe(t.canvas);
  });

  it("keeps the bias board's captions at 4.5:1 on every market tint", () => {
    expect(TINT_CAPTION.color).toBe(palette.label2);
    expect(
      failures(t, cross(['label2'], ['bullTint', 'bearTint', 'gexTint', 'amberTint']), 4.5),
    ).toEqual([]);
  });

  it('keeps the chart series colors at 3:1 on the cards and page a chart sits on', () => {
    expect(
      failures(t, cross(['chart', 'chartAlt', 'chartLight'], ['canvas', 'surface']), 3),
    ).toEqual([]);
    // The series color is never one of the colors that mean something.
    for (const meaning of [t.done, t.accent, t.danger]) expect(t.chart).not.toBe(meaning);
  });

  it('keeps the placeholder tone below small-text contrast, for placeholders and large totals', () => {
    expect(contrast(t.placeholder, t.surface)).toBeLessThan(4.5);
    expect(contrast(t.placeholder, t.surface)).toBeGreaterThanOrEqual(3);
  });

  it('keeps every word on a wash at 4.5:1 where the wash is strongest', () => {
    // Today's header and hero card (washWarm into washRose), the cleared hero, Day Cleared and its
    // panel (washMint), and the Mornings card (washWarm): each text color drawn inside a washed
    // container, at the wash's full strength, the worst case. The weekday letters of the hero's
    // week are `label2`, today's letter `accentText` or `doneText`, "Your best" `doneText`.
    expect(
      failures(
        t,
        cross(['label', 'label2', 'doneText', 'accentText'], ['washWarm', 'washRose', 'washMint']),
        4.5,
      ),
    ).toEqual([]);
  });

  it("keeps Progress's scoreboard pills and Week's columns readable", () => {
    // A rise: Fern on its tint; a fall or no change: label2 on the card or the quiet fill.
    expect(
      failures(
        t,
        [
          ['doneText', 'doneTint'],
          ['label2', 'surface'],
          ['label2', 'fill'],
        ],
        4.5,
      ),
    ).toEqual([]);
    // Last month's figure, large rounded text in label3 on the month panel: 3:1 for large text.
    expect(contrast(t.label3, t.fill)).toBeGreaterThanOrEqual(3);
    // A cleared column's tick on Fern, and today's weekday in Ember text on the card.
    expect(contrast(t.onDone, t.done)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.accentText, t.surface)).toBeGreaterThanOrEqual(4.5);
    // The marks themselves: a Fern disc or ring and today's Ember ring at 3:1 on the card.
    expect(failures(t, cross(['done', 'accent', 'label3'], ['surface']), 3)).toEqual([]);
  });

  it("keeps each program area's symbol at 4.5:1 on its tile, and no area a color of meaning", () => {
    const areas = ['Sun', 'Sky', 'Plum', 'Rose', 'Slate'];
    expect(
      failures(
        t,
        areas.map((a) => [`area${a}`, `area${a}Tint`] as [string, string]),
        4.5,
      ),
    ).toEqual([]);
    for (const a of areas)
      for (const meaning of [t.done, t.doneText, t.accent, t.accentText, t.danger])
        expect(t[`area${a}` as keyof typeof t]).not.toBe(meaning);
  });

  it('draws a switch at 3:1: its off track on the page and cards, its knob on either track', () => {
    expect(failures(t, cross(['checkEdge'], ['canvas', 'surface']), 3)).toEqual([]);
    expect(contrast(t.knob, t.checkEdge)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.onLabel, t.label)).toBeGreaterThanOrEqual(3);
    // On is the text color's track, off the check edge's: the two never look alike.
    expect(contrast(t.label, t.checkEdge)).toBeGreaterThanOrEqual(3);
  });

  it('keeps the tab labels at 4.5:1 on the translucent bar over the page, and on the pill', () => {
    expect(contrast(t.label2, over(t.glass, t.canvas))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.accentText, t.accentTint)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('appearances', () => {
  it('defines every token in both appearances, each as one adaptive color', () => {
    expect(Object.keys(tokens.dark).sort()).toEqual(Object.keys(tokens.light).sort());
    expect(Object.keys({ ...palette, ...market }).sort()).toEqual(Object.keys(tokens.light).sort());
    for (const value of [...Object.values(tokens.light), ...Object.values(tokens.dark)])
      expect(value).toMatch(/^#[0-9A-F]{6}([0-9A-F]{2})?$/);
  });

  it('gives the web both appearances as CSS variables, dark under prefers-color-scheme', () => {
    const css = themeCss();
    expect(css).toContain(`--lo-canvas:${tokens.light.canvas};`);
    expect(css).toMatch(
      new RegExp(
        `@media \\(prefers-color-scheme: dark\\)\\{:root\\{[^}]*--lo-canvas:${tokens.dark.canvas};`,
      ),
    );
    expect(css).toContain(`--lo-bull-tint:${tokens.dark.bullTint};`);
  });

  it('keeps warm paper and warm charcoal as the page, Ember for now and Fern for done', () => {
    expect(tokens.light.canvas).toBe('#F7F4EF');
    expect(tokens.dark.canvas).toBe('#100F0E');
    expect([tokens.light.accent, tokens.dark.accent]).toEqual(['#AE4E18', '#FF9A57']);
    expect([tokens.light.done, tokens.dark.done]).toEqual(['#1C7A50', '#5FD3A6']);
  });
});

describe('type scale', () => {
  it('holds the title, sheet, card and figure styles', () => {
    expect(type.title).toMatchObject({ fontSize: 34, lineHeight: 41, fontWeight: '700' });
    expect(type.sheetTitle).toMatchObject({ fontSize: 22, lineHeight: 28 });
    expect(type.cardTitle).toMatchObject({ fontSize: 20, lineHeight: 25 });
    expect(type.figure).toMatchObject({ fontSize: 30, lineHeight: 34 });
    expect(type.small).toMatchObject({ fontSize: 15, lineHeight: 20 });
  });

  it('sets text in the system face and every figure in rounded tabular numbers', () => {
    for (const style of [type.title, type.body, type.item, type.caption, type.meta])
      expect(style.fontFamily).toBe('System');
    for (const style of [type.count, type.figure, type.value, type.hero, fonts.figure])
      expect(style).toMatchObject({ fontFamily: 'ui-rounded', fontVariant: ['tabular-nums'] });
  });

  it('keeps uppercase to the word tags and the cockpit status title', () => {
    const upper = Object.entries(type)
      .filter(([, style]) => 'textTransform' in style && style.textTransform === 'uppercase')
      .map(([name]) => name);
    expect(upper.sort()).toEqual(['status', 'tag']);
  });

  it('draws no style in Fern by default: Fern is set only where something is done', () => {
    for (const [name, style] of Object.entries(type))
      expect([name, style.color === palette.done || style.color === palette.doneText]).toEqual([
        name,
        false,
      ]);
  });
});
