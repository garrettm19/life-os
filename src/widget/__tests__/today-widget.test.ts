import { describe, expect, jest, test } from '@jest/globals';
import { emptyState, type Program } from '../../domain/model';
import { generateDay } from '../../domain/planner';
import {
  type TodayWidgetProps,
  type WidgetDayStatus,
  todayWidgetTimeline,
} from '../../domain/widget';
import { anchorState } from '../../test-support/fixtures';
import { tokens } from '../../ui/theme';
import { timelinePublisher, todayWidgetLayout } from '../today-widget.ios';

// The widgets Babel plugin turns the layout into the string the extension evaluates. Evaluating it
// here with stub components checks the shipped layout, and any reference to module scope throws,
// exactly as it would inside the widget extension. It does not prove native rendering.
type Node = { type: string; props: Record<string, unknown> };
type Modifier = { modifier: string; args: unknown[] };
type Env = {
  colorScheme?: string;
  isLuminanceReduced?: boolean;
  showsContainerBackground?: boolean;
};

const components = [
  'Text',
  'Divider',
  'VStack',
  'HStack',
  'ZStack',
  'Image',
  'Spacer',
  'ProgressView',
  'AccessoryWidgetBackground',
];
const modifiers = [
  'accessibilityElement',
  'accessibilityHidden',
  'accessibilityLabel',
  'background',
  'containerBackground',
  'font',
  'foregroundStyle',
  'frame',
  'kerning',
  'labelsHidden',
  'layoutPriority',
  'lineLimit',
  'minimumScaleFactor',
  'monospacedDigit',
  'padding',
  'privacySensitive',
  'progressViewStyle',
  'shadow',
  'tint',
  'widgetAccentedRenderingMode',
  'widgetURL',
];

// The shape builders the widget passes to `background`, as plain records.
const shapes = {
  capsule: (params: object = {}) => ({ shape: 'capsule', ...params }),
  roundedRectangle: (params: object) => ({ shape: 'roundedRectangle', ...params }),
};

function render(props: TodayWidgetProps, family: string, mode = 'fullColor', env: Env = {}): Node {
  const jsx = (type: { name: string }, nodeProps: Record<string, unknown>): Node => ({
    type: type.name,
    props: nodeProps,
  });
  const componentImpls = components.map((name) => ({ [name]: () => null })[name]);
  const modifierImpls = modifiers.map((name) => (...args: unknown[]): Modifier => ({
    modifier: name,
    args,
  }));
  const layout = new Function(
    '_jsx',
    '_jsxs',
    ...components,
    ...modifiers,
    'shapes',
    `return (${String(todayWidgetLayout)});`,
  )(jsx, jsx, ...componentImpls, ...modifierImpls, shapes) as (p: object, e: object) => Node;
  return layout(props, {
    widgetFamily: family,
    widgetRenderingMode: mode,
    date: new Date(),
    colorScheme: 'dark',
    ...env,
  });
}

const children = (node: Node): unknown[] =>
  ([] as unknown[]).concat(node.props.children ?? []).filter((c) => c !== null && c !== false);

function texts(node: Node): string[] {
  return children(node).flatMap((child) =>
    typeof child === 'string'
      ? [child]
      : child && typeof child === 'object'
        ? texts(child as Node)
        : [],
  );
}

function nodes(node: Node): Node[] {
  return [
    node,
    ...children(node).flatMap((child) =>
      child && typeof child === 'object' ? nodes(child as Node) : [],
    ),
  ];
}

const mods = (node: Node) => (node.props.modifiers as Modifier[] | undefined) ?? [];
const names = (node: Node) => mods(node).map((m) => m.modifier);
const holding = (tree: Node, value: string) =>
  nodes(tree).find((n) => children(n).includes(value))!;
const symbols = (tree: Node) =>
  nodes(tree)
    .filter((n) => n.type === 'Image')
    .map((n) => n.props.systemName);
// WCAG 2.2 contrast for #RRGGBB colors, as in src/ui/__tests__/theme.test.ts.
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b2] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// Each node with the colors under it: the widget's ground, or the nearest drawn panel or capsule.
function grounds(node: Node, under: string[]): [Node, string[]][] {
  const own = mods(node).find((m) => m.modifier === 'background')?.args[0];
  const here = typeof own === 'string' ? [own] : under;
  return [
    [node, here],
    ...children(node).flatMap((child) =>
      child && typeof child === 'object' ? grounds(child as Node, here) : [],
    ),
  ];
}
const home = ['systemSmall', 'systemMedium'];
const lock = ['accessoryInline', 'accessoryRectangular', 'accessoryCircular'];
const modes = ['fullColor', 'accented', 'vibrant'];
const kinds: TodayWidgetProps['kind'][] = ['now', 'next', 'clear', 'empty', 'stale'];
const statuses: (WidgetDayStatus | undefined)[] = [
  undefined,
  'cleared',
  'remaining',
  'plan',
  'unresolved',
  'protected',
  'empty',
  'absent',
];
const scheduled = (kind: TodayWidgetProps['kind']) =>
  kind === 'now' || kind === 'next' ? { title: 'Example session', time: '9:00 AM – 9:30 AM' } : {};
const bar = {
  startsAt: new Date(2026, 10, 4, 9, 0).toISOString(),
  endsAt: new Date(2026, 10, 4, 9, 30).toISOString(),
};
const statusCopy: [WidgetDayStatus, string, string][] = [
  ['remaining', 'Objectives remaining', 'circle.dashed'],
  ['plan', 'Open Life OS to plan today', 'calendar.badge.clock'],
  ['unresolved', 'All skipped · not cleared', 'circle.slash'],
  ['protected', 'Day protected', 'shield'],
  ['empty', 'Nothing due today', 'moon'],
  ['absent', 'Nothing recorded yet', 'circle'],
];
const environments: Env[] = [
  {},
  { colorScheme: 'light' },
  { isLuminanceReduced: true },
  { showsContainerBackground: false },
];

describe('the shipped widget layout', () => {
  test('renders every family, state, rendering mode and appearance without outside references', () => {
    for (const kind of [...kinds, undefined])
      for (const day of statuses)
        for (const family of [...home, ...lock])
          for (const mode of modes)
            for (const env of environments)
              for (const extra of [
                {},
                { anchor: '7:10 AM', upBy: '7:10 AM', todo: 'Example habit' },
              ]) {
                const props = {
                  ...(kind && { kind }),
                  ...scheduled(kind ?? 'empty'),
                  ...(kind === 'now' && bar),
                  ...(day && { day }),
                  ...extra,
                } as TodayWidgetProps;
                const tree = render(props, family, mode, env);
                expect(texts(tree).length + symbols(tree).length).toBeGreaterThan(0);
              }
  });

  test('before the app has published, the widget says to open it, never that nothing is scheduled', () => {
    for (const family of home)
      for (const mode of modes) {
        const tree = render({} as TodayWidgetProps, family, mode);
        expect(texts(tree)).toEqual(['LIFE OS', 'Open Life OS to show today']);
        expect(symbols(tree)).toEqual(['arrow.up.forward.app']);
        expect(mods(tree)).toContainEqual({ modifier: 'widgetURL', args: ['personalos:///'] });
      }
  });

  test('after midnight it greets the new day, with the Up by time when there is one', () => {
    for (const family of home) {
      for (const day of statuses) {
        // A stale entry never carries a status, but even one left over never shows.
        const tree = render({ kind: 'stale', ...(day && { day }) }, family);
        expect(texts(tree)).toEqual(['NEW DAY', 'Tap to load today']);
        expect(symbols(tree)).toEqual(['sunrise.fill']);
      }
      const morning = render({ kind: 'stale', anchor: '7:10 AM' }, family);
      // Small: a capsule in the foot; medium: a panel beside the day, the time in large figures.
      const upBy = family === 'systemSmall' ? ['Up by 7:10 AM'] : ['Up by', '7:10 AM'];
      expect(texts(morning)).toEqual(['NEW DAY', 'Tap to load today', ...upBy]);
      // The anchor time is the user's to show; the rest of the state is not.
      for (const value of upBy)
        expect(names(holding(morning, value))).not.toContain('privacySensitive');
      expect(names(holding(morning, 'Tap to load today'))).not.toContain('privacySensitive');
    }
  });

  test('a block on the clock leads, with its time on one line in rounded fixed-width digits and a bar that empties', () => {
    for (const family of home) {
      const tree = render({ kind: 'now', ...scheduled('now'), ...bar }, family);
      // Small puts the time under the title; medium in the kicker, so THEN fits under it.
      expect(texts(tree)).toEqual(
        family === 'systemSmall'
          ? ['NOW', 'Example session', '9:00 AM – 9:30 AM']
          : ['NOW', '·', '9:00 AM – 9:30 AM', 'Example session'],
      );
      const time = holding(tree, '9:00 AM – 9:30 AM');
      expect(names(time)).toEqual(
        expect.arrayContaining(['monospacedDigit', 'layoutPriority', 'privacySensitive']),
      );
      expect(mods(time)).toContainEqual({ modifier: 'lineLimit', args: [1] });
      expect(mods(time).find((m) => m.modifier === 'font')!.args[0]).toMatchObject({
        design: 'rounded',
      });
      // The separator is drawn, not read.
      if (family === 'systemMedium')
        expect(names(holding(tree, '·'))).toContain('accessibilityHidden');
      const progress = nodes(tree).find((n) => n.type === 'ProgressView')!;
      expect(progress.props.countsDown).toBe(true);
      expect(progress.props.timerInterval).toEqual({
        lower: new Date(bar.startsAt),
        upper: new Date(bar.endsAt),
      });
      // Ember: what is happening now.
      expect(mods(progress)).toContainEqual({ modifier: 'tint', args: ['#FF9A57'] });
      expect(names(progress)).toContain('accessibilityHidden');
      // The bar alone: SwiftUI's remaining-time label under a timer bar is hidden.
      expect(names(progress)).toContain('labelsHidden');
      // Tinted: the bar takes the system's tint, not Ember.
      const tinted = nodes(
        render({ kind: 'now', ...scheduled('now'), ...bar }, family, 'accented'),
      );
      expect(mods(tinted.find((n) => n.type === 'ProgressView')!)).toContainEqual({
        modifier: 'tint',
        args: [{ type: 'hierarchical', style: 'secondary' }],
      });
    }
    // Up next, or a block without a length, has no bar.
    for (const props of [
      { kind: 'next' as const, ...scheduled('next'), ...bar },
      { kind: 'now' as const, ...scheduled('now') },
    ])
      expect(nodes(render(props, 'systemMedium')).some((n) => n.type === 'ProgressView')).toBe(
        false,
      );
  });

  test('medium adds THEN with the following public block; small keeps one message', () => {
    const props: TodayWidgetProps = {
      kind: 'next',
      ...scheduled('next'),
      later: 'Example review',
      laterTime: '10:00 AM',
    };
    const medium = render(props, 'systemMedium');
    expect(texts(medium)).toEqual([
      'NEXT',
      '·',
      '9:00 AM – 9:30 AM',
      'Example session',
      'THEN',
      '·',
      '10:00 AM',
      'Example review',
    ]);
    for (const value of ['Example review', '10:00 AM'])
      expect(names(holding(medium, value))).toContain('privacySensitive');
    // NEXT over THEN, a hairline between them; with THEN the title keeps to one line.
    expect(nodes(medium).some((n) => n.type === 'Divider')).toBe(true);
    expect(mods(holding(medium, 'Example session'))).toContainEqual({
      modifier: 'lineLimit',
      args: [1],
    });
    expect(texts(render(props, 'systemSmall'))).toEqual([
      'NEXT',
      'Example session',
      '9:00 AM – 9:30 AM',
    ]);
  });

  test('with nothing left on the clock, the next public objective on the list leads', () => {
    for (const kind of ['clear', 'empty'] as const)
      for (const family of home) {
        const tree = render({ kind, todo: 'Example habit' }, family);
        expect(texts(tree)).toEqual(['ON THE LIST', 'Example habit']);
        expect(symbols(tree)).toEqual(['circle']);
        expect(names(holding(tree, 'Example habit'))).toContain('privacySensitive');
        expect(mods(holding(tree, 'ON THE LIST'))).toContainEqual({
          modifier: 'foregroundStyle',
          args: ['#FFA86E'],
        });
      }
    // With the opt-in, medium keeps the status under it; small keeps one message.
    expect(
      texts(render({ kind: 'clear', todo: 'Example habit', day: 'remaining' }, 'systemMedium')),
    ).toEqual(['ON THE LIST', 'Example habit', 'Objectives remaining']);
    expect(
      texts(render({ kind: 'clear', todo: 'Example habit', day: 'remaining' }, 'systemSmall')),
    ).toEqual(['ON THE LIST', 'Example habit']);
    // Without one: the schedule's own neutral words.
    expect(texts(render({ kind: 'clear' }, 'systemSmall'))).toEqual([
      'LIFE OS · TODAY',
      'Nothing else scheduled today',
    ]);
    expect(texts(render({ kind: 'empty' }, 'systemSmall'))).toEqual([
      'LIFE OS · TODAY',
      'Nothing scheduled today',
    ]);
  });

  test('every day status reads honestly, with its own symbol', () => {
    for (const [day, text, symbol] of statusCopy)
      for (const family of home) {
        const tree = render({ kind: 'clear', day }, family);
        expect(texts(tree)).toEqual(['LIFE OS · TODAY', text]);
        expect(symbols(tree)).toEqual([symbol]);
        expect(names(holding(tree, text))).toContain('privacySensitive');
        // The symbol is redacted with the words: it shows the opt-in status too.
        const image = (t: Node) => nodes(t).find((n) => n.props.systemName === symbol)!;
        expect(names(image(tree))).toContain('privacySensitive');
        // Under a block, on medium, the status keeps its symbol.
        const under = render({ kind: 'next', ...scheduled('next'), day }, 'systemMedium');
        expect(texts(under).at(-1)).toBe(text);
        expect(symbols(under)).toContain(symbol);
        expect(names(image(under))).toContain('privacySensitive');
      }
    // Symbols that are not a status stay as they are.
    const listed = render({ kind: 'clear', todo: 'Example habit' }, 'systemSmall');
    expect(names(nodes(listed).find((n) => n.type === 'Image')!)).not.toContain('privacySensitive');
    expect(
      texts(render({ kind: 'next', ...scheduled('next'), day: 'remaining' }, 'systemSmall')),
    ).toEqual(['NEXT', 'Example session', '9:00 AM – 9:30 AM']);
  });

  test('in the morning the Home Screen adds the Up by time, alone and unredacted; never a title', () => {
    const small = render({ kind: 'next', ...scheduled('next'), upBy: '7:10 AM' }, 'systemSmall');
    expect(texts(small)).toEqual(['NEXT', 'Example session', '9:00 AM – 9:30 AM', 'Up by 7:10 AM']);
    // A soft Ember capsule with a sunrise, the time in rounded figures.
    const pill = nodes(small).find((n) =>
      children(n).some((x) => (x as Node).props?.children === 'Up by 7:10 AM'),
    )!;
    expect(mods(pill)).toContainEqual({
      modifier: 'background',
      args: ['#3A2618', { shape: 'capsule', roundedCornerStyle: 'continuous' }],
    });
    expect(symbols(pill)).toEqual(['sunrise.fill']);
    expect(mods(holding(small, 'Example session'))).toContainEqual({
      modifier: 'lineLimit',
      args: [2],
    });
    expect(names(holding(small, 'Up by 7:10 AM'))).not.toContain('privacySensitive');
    const medium = render(
      { kind: 'next', ...scheduled('next'), day: 'remaining', upBy: '7:10 AM' },
      'systemMedium',
    );
    expect(texts(medium).slice(-3)).toEqual(['Objectives remaining', 'Up by', '7:10 AM']);
    // Medium: a panel on the Ember tint beside the day, the time in large rounded figures.
    const time = holding(medium, '7:10 AM');
    expect(mods(time)).toContainEqual({
      modifier: 'font',
      args: [{ textStyle: 'title3', weight: 'bold', design: 'rounded' }],
    });
    expect(names(time)).not.toContain('privacySensitive');
    const panel = nodes(medium).find((n) => children(n).includes(time))!;
    expect(mods(panel)).toContainEqual({
      modifier: 'background',
      args: [
        '#3A2618',
        { shape: 'roundedRectangle', cornerRadius: 16, roundedCornerStyle: 'continuous' },
      ],
    });
    expect(
      nodes(render({ kind: 'next', ...scheduled('next') }, 'systemMedium')).some((n) =>
        names(n).includes('background'),
      ),
    ).toBe(false);
    // `anchor` alone is for the Lock Screen: on a day's entry after the time, nothing shows.
    expect(
      texts(render({ kind: 'next', ...scheduled('next'), anchor: '7:10 AM' }, 'systemSmall')),
    ).not.toContain('Up by 7:10 AM');
  });

  test('only a true Day Cleared shows Fern and the seal', () => {
    for (const family of home) {
      const tree = render({ kind: 'clear', day: 'cleared' }, family, 'fullColor');
      expect(texts(tree)).toEqual(['Day cleared', 'Everything due is done']);
      // The one expressive line, in rounded heavy type as in the app.
      expect(mods(holding(tree, 'Day cleared'))).toContainEqual({
        modifier: 'font',
        args: [{ textStyle: 'title2', weight: 'heavy', design: 'rounded' }],
      });
      const background = mods(tree).find((m) => m.modifier === 'containerBackground')!;
      expect(background.args[0]).toMatchObject({ type: 'radialGradient' });
      const seal = nodes(tree).find((n) => n.type === 'Image')!;
      expect(seal.props).toMatchObject({ systemName: 'checkmark.seal.fill', color: '#5FD3A6' });
      expect(names(seal)).toContain('shadow');
      expect(names(seal)).toContain('privacySensitive');
      expect(mods(tree)).toContainEqual({
        modifier: 'accessibilityLabel',
        args: ['Life OS. Day cleared. Everything due is done.'],
      });
      expect(mods(tree)).toContainEqual({ modifier: 'widgetURL', args: ['personalos:///'] });
    }
    for (const kind of [...kinds, undefined])
      for (const day of statuses.filter((status) => status !== 'cleared'))
        for (const scheme of ['dark', 'light']) {
          const json = JSON.stringify(
            render(
              {
                ...(kind && { kind }),
                ...(day && { day }),
                todo: 'Example habit',
              } as TodayWidgetProps,
              'systemMedium',
              'fullColor',
              { colorScheme: scheme },
            ),
          );
          expect(json).not.toContain('Day cleared');
          for (const fern of ['#5FD3A6', '#6FDCB1', '#1C7A50', '#196B46', '#E2F3E9', '#15302A'])
            expect(json).not.toContain(fern);
          expect(json).not.toContain('checkmark.seal');
        }
  });

  test('light and dark follow the Home Screen, in the app’s own palette', () => {
    const props: TodayWidgetProps = { kind: 'next', ...scheduled('next') };
    const gradient = (tree: Node) =>
      (
        mods(tree).find((m) => m.modifier === 'containerBackground')!.args[0] as {
          colors: string[];
        }
      ).colors;
    const lightTree = render(props, 'systemMedium', 'fullColor', { colorScheme: 'light' });
    expect(gradient(lightTree)).toEqual([tokens.light.surface, tokens.light.canvas]);
    expect(mods(holding(lightTree, 'Example session'))).toContainEqual({
      modifier: 'foregroundStyle',
      args: [tokens.light.label],
    });
    expect(mods(holding(lightTree, 'NEXT'))).toContainEqual({
      modifier: 'foregroundStyle',
      args: [tokens.light.accentText],
    });
    // Dark, and any scheme the system does not name, keep the dark palette.
    for (const colorScheme of ['dark', 'unknown']) {
      const darkTree = render(props, 'systemMedium', 'fullColor', { colorScheme });
      expect(gradient(darkTree)).toEqual([tokens.dark.surface, tokens.dark.canvas]);
      expect(mods(holding(darkTree, 'Example session'))).toContainEqual({
        modifier: 'foregroundStyle',
        args: [tokens.dark.label],
      });
      expect(mods(holding(darkTree, 'NEXT'))).toContainEqual({
        modifier: 'foregroundStyle',
        args: [tokens.dark.accentText],
      });
    }
    const cleared = render({ kind: 'clear', day: 'cleared' }, 'systemSmall', 'fullColor', {
      colorScheme: 'light',
    });
    expect(mods(cleared).find((m) => m.modifier === 'containerBackground')!.args[0]).toMatchObject({
      colors: [tokens.light.doneTint, tokens.light.surface],
    });
    expect(nodes(cleared).find((n) => n.type === 'Image')!.props.color).toBe(tokens.light.done);
  });

  test('every word keeps 4.5:1 and every colored symbol 3:1 on its own ground, in both appearances', () => {
    const states = [
      ...kinds.flatMap((kind) =>
        statuses.map(
          (day) =>
            ({
              kind,
              ...scheduled(kind),
              ...(kind === 'now' && bar),
              ...(day && { day }),
              later: 'Example review',
              laterTime: '10:00 AM',
              todo: 'Example habit',
              anchor: '7:10 AM',
              upBy: '7:10 AM',
            }) as TodayWidgetProps,
        ),
      ),
      {} as TodayWidgetProps,
    ];
    let checked = 0;
    const failures: string[] = [];
    for (const colorScheme of ['light', 'dark'])
      for (const family of home)
        for (const props of states) {
          const tree = render(props, family, 'fullColor', { colorScheme });
          const background = mods(tree).find((m) => m.modifier === 'containerBackground')!.args[0];
          const ground =
            typeof background === 'string'
              ? [background]
              : (background as { colors: string[] }).colors;
          for (const [node, under] of grounds(tree, ground)) {
            const style = mods(node).find((m) => m.modifier === 'foregroundStyle')?.args[0];
            const color = node.type === 'Image' ? node.props.color : style;
            if (typeof color !== 'string') continue;
            for (const bg of under)
              if (contrast(color, bg) < (node.type === 'Image' ? 3 : 4.5))
                failures.push(`${node.type} ${color} on ${bg}: ${contrast(color, bg).toFixed(2)}`);
            checked += 1;
          }
        }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(500);
  });

  test('tinted and clear Home Screens drop every color and glow; the words and symbols stay', () => {
    // The mode strings come from a Swift description, so a qualified form is read the same way.
    for (const mode of ['accented', 'vibrant', 'WidgetRenderingMode.accented'])
      for (const family of home)
        for (const props of [
          { kind: 'clear', day: 'cleared' },
          { kind: 'now', ...scheduled('now'), ...bar, day: 'protected', upBy: '7:10 AM' },
          { kind: 'clear', todo: 'Example habit' },
          { kind: 'stale', anchor: '7:10 AM' },
        ] as TodayWidgetProps[]) {
          const tree = render(props, family, mode);
          for (const image of nodes(tree).filter((n) => n.type === 'Image')) {
            expect(image.props.color).toBeUndefined();
            expect(names(image)).not.toContain('shadow');
          }
          for (const node of nodes(tree))
            for (const m of mods(node).filter((x) => x.modifier === 'foregroundStyle'))
              expect(m.args[0]).toMatchObject({ type: 'hierarchical' });
          expect(texts(tree).length).toBeGreaterThan(1);
        }
    const seal = nodes(render({ kind: 'clear', day: 'cleared' }, 'systemSmall', 'accented')).find(
      (n) => n.type === 'Image',
    )!;
    expect(mods(seal)).toContainEqual({
      modifier: 'widgetAccentedRenderingMode',
      args: ['accented'],
    });
  });

  test('Always On uses outlines without glow; StandBy and CarPlay get a larger headline and no glow', () => {
    for (const family of home) {
      const dim = render({ kind: 'clear', day: 'cleared' }, family, 'fullColor', {
        isLuminanceReduced: true,
      });
      const seal = nodes(dim).find((n) => n.type === 'Image')!;
      expect(seal.props.systemName).toBe('checkmark.seal');
      expect(names(seal)).not.toContain('shadow');
      expect(
        symbols(
          render({ kind: 'stale', anchor: '7:10 AM' }, family, 'fullColor', {
            isLuminanceReduced: true,
          }),
        ),
      ).toEqual(['sunrise.fill', 'sunrise']);

      const standBy = { showsContainerBackground: false };
      const bare = render({ kind: 'clear', day: 'cleared' }, family, 'fullColor', standBy);
      expect(names(nodes(bare).find((n) => n.type === 'Image')!)).not.toContain('shadow');
      expect(typeof mods(bare).find((m) => m.modifier === 'containerBackground')!.args[0]).toBe(
        'string',
      );
      const big = render({ kind: 'next', ...scheduled('next') }, family, 'fullColor', standBy);
      expect(mods(holding(big, 'Example session'))).toContainEqual({
        modifier: 'font',
        args: [{ textStyle: 'title2', weight: 'semibold' }],
      });
    }
  });

  test('a tap on any Home Screen state opens Today', () => {
    for (const kind of [...kinds, undefined])
      for (const day of statuses)
        for (const family of home) {
          const tree = render(
            {
              ...(kind && { kind }),
              ...scheduled(kind ?? 'empty'),
              ...(day && { day }),
            } as TodayWidgetProps,
            family,
          );
          expect(mods(tree)).toContainEqual({ modifier: 'widgetURL', args: ['personalos:///'] });
        }
  });

  test('no Home Screen state shows a count, a ring, a streak or money', () => {
    for (const kind of [...kinds, undefined])
      for (const day of statuses)
        for (const family of home) {
          const tree = render(
            {
              ...(kind && { kind }),
              ...scheduled(kind ?? 'empty'),
              ...(day && { day }),
              todo: 'Example habit',
              later: 'Example review',
              laterTime: '10:00 AM',
              upBy: '7:10 AM',
            } as TodayWidgetProps,
            family,
          );
          const words = texts(tree).join(' ');
          // Digits appear only in clock times.
          expect(words.replace(/\d{1,2}:\d{2} (AM|PM)/g, '')).not.toMatch(/\d/);
          expect(words).not.toMatch(/streak|\$|%/i);
          expect(
            nodes(tree).some((n) => n.type === 'ProgressView' && n.props.value !== undefined),
          ).toBe(false);
        }
  });

  test('a private session on the clock never reaches the rendered widget', () => {
    const routine = (id: string, extra: Partial<Program['routines'][number]>) => ({
      id,
      title: `Example ${id}`,
      duration: 30,
      weekdays: [4],
      preferredStart: 720,
      enabled: true,
      fixed: false,
      steps: [],
      bundledInto: null,
      ...extra,
    });
    const programs: Program[] = [
      {
        id: 'example-program',
        title: 'Example program',
        group: 'Daily',
        goalIds: [],
        routines: [
          routine('secret', { title: 'Example private session', private: true }),
          routine('public', { preferredStart: 900 }),
        ],
      },
    ];
    const state = {
      ...emptyState(),
      programs,
      settings: { ...emptyState().settings, widgetDayStatus: true },
      days: { '2026-10-08': generateDay('2026-10-08', emptyState().settings, programs) },
    };
    const entries = todayWidgetTimeline(state, new Date(2026, 9, 8, 10, 0));
    const rendered = entries.map((e) => render(e.props, 'systemMedium', 'fullColor'));
    // The public session is next; the earlier private one is skipped rather than shown.
    expect(texts(rendered[0])[0]).toBe('NEXT');
    expect(texts(rendered[0])).toContain('Example public');
    expect(JSON.stringify(rendered)).not.toContain('Example private session');
  });

  test('the Lock Screen shows the anchor time alone, unredacted: no block, day status or count', () => {
    const forbidden = [
      'Day cleared',
      'Everything due is done',
      ...statusCopy.map(([, text]) => text),
      'Example session',
      '9:00 AM',
      'Example habit',
      'Example review',
      'NEW DAY',
    ];
    const expected = (family: string, anchor?: string) =>
      anchor
        ? family === 'accessoryInline'
          ? ['Up by 7:10 AM']
          : family === 'accessoryRectangular'
            ? ['UP BY', '7:10 AM']
            : ['7:10', 'AM']
        : family === 'accessoryInline'
          ? ['Life OS']
          : family === 'accessoryRectangular'
            ? ['Life OS', 'Set an Up by time in Programs']
            : [];
    for (const kind of [...kinds, undefined])
      for (const day of statuses)
        for (const family of lock)
          for (const anchor of [undefined, '7:10 AM'])
            for (const mode of modes)
              for (const env of environments) {
                const props = {
                  ...(kind && { kind }),
                  ...scheduled(kind ?? 'empty'),
                  ...(day && { day }),
                  ...(anchor && { anchor, upBy: anchor }),
                  todo: 'Example habit',
                  later: 'Example review',
                } as TodayWidgetProps;
                const tree = render(props, family, mode, env);
                const shown = texts(tree);
                expect(shown).toEqual(expected(family, anchor));
                const json = JSON.stringify(tree);
                for (const copy of forbidden) expect(json).not.toContain(copy);
                // iOS tints the Lock Screen: no color of its own.
                expect(json).not.toMatch(/#[0-9A-F]{6}/i);
                expect(mods(tree)).toContainEqual({
                  modifier: 'widgetURL',
                  args: ['personalos:///'],
                });
                for (const node of nodes(tree))
                  expect(names(node)).not.toContain('privacySensitive');
              }
    // The circle sits on the system's accessory background, with the sunrise above the time.
    const circle = render({ kind: 'next', anchor: '7:10 AM' }, 'accessoryCircular');
    expect(circle.type).toBe('ZStack');
    expect(nodes(circle).map((n) => n.type)).toContain('AccessoryWidgetBackground');
    expect(symbols(circle)).toEqual(['sunrise.fill']);
    expect(mods(circle)).toContainEqual({
      modifier: 'accessibilityLabel',
      args: ['Life OS. Up by 7:10 AM.'],
    });
    const unset = render({ kind: 'next' }, 'accessoryCircular');
    expect(symbols(unset)).toEqual(['sunrise']);
    expect(mods(unset)).toContainEqual({
      modifier: 'accessibilityLabel',
      args: ['Life OS. No Up by time set.'],
    });
    // The rectangle: a sunrise beside UP BY over the time, large, in rounded fixed-width digits.
    const rectangle = render({ kind: 'stale', anchor: '7:10 AM' }, 'accessoryRectangular');
    expect(symbols(rectangle)).toEqual(['sunrise.fill']);
    expect(rectangle.type).toBe('HStack');
    expect(names(holding(rectangle, '7:10 AM'))).toContain('monospacedDigit');
    expect(mods(holding(rectangle, '7:10 AM'))).toContainEqual({
      modifier: 'font',
      args: [{ textStyle: 'title', weight: 'bold', design: 'rounded' }],
    });
    // After midnight the anchor still shows, not a request to open the app.
    for (const family of lock)
      expect(texts(render({ kind: 'stale', anchor: '7:10 AM' }, family, 'vibrant'))).toEqual(
        expected(family, '7:10 AM'),
      );
  });

  test('a published timeline puts nothing private on the Lock Screen, anchor or not', () => {
    const wednesday = '2026-11-04';
    const withPrivate = (anchorPrivate: boolean, anchorOn: boolean) => {
      const s = anchorState();
      s.programs = s.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) =>
          r.id === 'up'
            ? { ...r, private: anchorPrivate, enabled: anchorOn, title: 'Example private morning' }
            : r,
        ),
      }));
      s.days[wednesday] = {
        date: wednesday,
        revisions: [],
        blocks: [
          {
            id: 'sec',
            routineId: null,
            programId: null,
            title: 'Example private session',
            start: 720,
            duration: 30,
            fixed: false,
            status: 'planned',
            actualAt: null,
            steps: ['Example private step'],
            reason: null,
            private: true,
          },
        ],
      };
      return { ...s, settings: { ...s.settings, widgetDayStatus: true } };
    };
    for (const [anchorPrivate, anchorOn] of [
      [true, true],
      [false, false],
    ]) {
      const entries = todayWidgetTimeline(
        withPrivate(anchorPrivate, anchorOn),
        new Date(2026, 10, 4, 6, 0),
      );
      for (const family of lock) {
        const rendered = entries.map((e) => render(e.props, family, 'vibrant'));
        const json = JSON.stringify(rendered);
        for (const leak of [
          'Example private session',
          'Example private morning',
          'Example private step',
        ])
          expect(json).not.toContain(leak);
        const first = {
          accessoryInline: anchorOn ? 'Up by 7:10 AM' : 'Life OS',
          accessoryRectangular: anchorOn ? 'UP BY' : 'Life OS',
          accessoryCircular: anchorOn ? '7:10' : undefined,
        }[family];
        expect(rendered.every((tree) => texts(tree)[0] === first)).toBe(true);
        // Nothing numeric beyond the anchor time: no counts, streaks or amounts.
        for (const tree of rendered)
          expect(
            texts(tree)
              .join(' ')
              .replace(/7:10( AM)?/, ''),
          ).not.toMatch(/\d/);
      }
    }
  });

  test('publishing skips an unchanged timeline and retries after a failed native update', async () => {
    const mockUpdateTimeline = jest.fn();
    const publishTodayWidget = timelinePublisher(async () => ({
      updateTimeline: (entries) => mockUpdateTimeline(entries),
    }));
    const state = emptyState();
    await publishTodayWidget(state);
    await publishTodayWidget(state);
    expect(mockUpdateTimeline).toHaveBeenCalledTimes(1);
    const changed = { ...state, settings: { ...state.settings, widgetDayStatus: true } };
    mockUpdateTimeline.mockImplementationOnce(() => {
      throw new Error('Synthetic native failure');
    });
    await expect(publishTodayWidget(changed)).rejects.toThrow('Synthetic native failure');
    await publishTodayWidget(changed);
    expect(mockUpdateTimeline).toHaveBeenCalledTimes(3);
    await publishTodayWidget(changed);
    expect(mockUpdateTimeline).toHaveBeenCalledTimes(3);
  });
});
