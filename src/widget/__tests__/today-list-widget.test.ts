import { describe, expect, jest, test } from '@jest/globals';
import { emptyState } from '../../domain/model';
import type { TodayListProps } from '../../domain/widget-list';
import { tokens } from '../../ui/theme';
import { listPublisher, todayListLayout } from '../today-list-widget.ios';

// The widgets Babel plugin turns the layout into the string the extension evaluates. Evaluating it
// here with stub components checks the shipped layout, its button handlers, and that it reaches
// nothing outside its own body, as inside the widget extension. It does not prove native rendering.
type Node = { type: string; props: Record<string, unknown> };
type Modifier = { modifier: string; args: unknown[] };

const components = ['Text', 'VStack', 'HStack', 'Image', 'Spacer', 'Button'];
const modifiers = [
  'accessibilityElement',
  'accessibilityHidden',
  'accessibilityLabel',
  'background',
  'buttonStyle',
  'containerBackground',
  'dynamicTypeSize',
  'font',
  'foregroundStyle',
  'frame',
  'kerning',
  'layoutPriority',
  'lineLimit',
  'monospacedDigit',
  'multilineTextAlignment',
  'opacity',
  'padding',
  'privacySensitive',
  'shadow',
  'strikethrough',
  'widgetAccentedRenderingMode',
  'widgetURL',
];
type Env = {
  colorScheme?: string;
  isLuminanceReduced?: boolean;
  showsContainerBackground?: boolean;
};

// The shape builders the widget passes to `background`, as plain records.
const shapes = {
  capsule: (params: object = {}) => ({ shape: 'capsule', ...params }),
  roundedRectangle: (params: object) => ({ shape: 'roundedRectangle', ...params }),
};

function render(props: TodayListProps, mode = 'fullColor', env: Env = {}): Node {
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
    `return (${String(todayListLayout)});`,
  )(jsx, jsx, ...componentImpls, ...modifierImpls, shapes) as (p: object, e: object) => Node;
  return layout(props, {
    widgetFamily: 'systemLarge',
    widgetRenderingMode: mode,
    date: new Date(),
    colorScheme: 'dark',
    ...env,
  });
}

// The widget runtime flattens nested children (a mapped list beside other elements); so does this.
const children = (node: Node): unknown[] =>
  ([] as unknown[])
    .concat(node.props.children ?? [])
    .flat(Infinity)
    .filter((c) => c !== null && c !== false);
const nodes = (node: Node): Node[] => [
  node,
  ...children(node).flatMap((child) =>
    child && typeof child === 'object' ? nodes(child as Node) : [],
  ),
];
const texts = (node: Node): string[] =>
  children(node).flatMap((child) =>
    typeof child === 'string'
      ? [child]
      : child && typeof child === 'object'
        ? texts(child as Node)
        : [],
  );
const mods = (node: Node) => (node.props.modifiers as Modifier[] | undefined) ?? [];
const names = (node: Node) => mods(node).map((m) => m.modifier);
const holding = (tree: Node, value: string) =>
  nodes(tree).find((n) => children(n).includes(value))!;
const symbols = (tree: Node) =>
  nodes(tree)
    .filter((n) => n.type === 'Image')
    .map((n) => n.props.systemName);

const list: TodayListProps = {
  date: '2026-11-09',
  label: 'Mon, Nov 9',
  tasks: [
    { id: 'walk', title: 'Example walk', tap: true },
    { id: 'lift', title: 'Example workout', time: '5:30 PM' },
    { id: 'read', title: 'Example reading', done: true },
  ],
  more: 2,
};

describe('the Large list widget layout', () => {
  test('lists every task with its time, and how many more are in the app', () => {
    expect(texts(render(list))).toEqual([
      'TODAY',
      'Mon, Nov 9',
      'Example walk',
      'Example workout',
      '5:30 PM',
      'Example reading',
      '+2 more in Life OS',
    ]);
    const empty = render({ ...list, tasks: [], more: undefined });
    expect(texts(empty)).toEqual(['TODAY', 'Mon, Nov 9', 'Nothing left on the list today']);
    expect(mods(holding(empty, 'Nothing left on the list today'))).toContainEqual({
      modifier: 'multilineTextAlignment',
      args: ['center'],
    });
  });

  test('after midnight it greets the new day without yesterday’s date; before any publish it asks to open the app', () => {
    const stale = render({ ...list, stale: true, ticked: { walk: '2026-11-09T14:00:00.000Z' } });
    expect(texts(stale)).toEqual(['NEW DAY', 'Tap to load today']);
    expect(symbols(stale)).toEqual(['sunrise.fill']);
    expect(nodes(stale).some((n) => n.type === 'Button')).toBe(false);
    const unloaded = render({} as TodayListProps);
    expect(texts(unloaded)).toEqual(['TODAY', 'Open Life OS to show today’s list']);
    for (const tree of [stale, unloaded, render(list)])
      expect(mods(tree)).toContainEqual({ modifier: 'widgetURL', args: ['personalos:///'] });
  });

  test('only a one-tap task is a button; a tap fills its check Fern and dims it, a second takes it back', () => {
    const tree = render(list);
    const buttons = nodes(tree).filter((n) => n.type === 'Button');
    expect(buttons.map((b) => b.props.target)).toEqual(['walk']);
    // Only the circle is the button, named as in the app; the title beside it is not.
    expect(children(buttons[0]).map((child) => (child as Node).type)).toEqual(['Image']);
    expect(mods(buttons[0])).toContainEqual({
      modifier: 'accessibilityLabel',
      args: ['Mark Example walk done'],
    });
    const press = buttons[0].props.onPress as () => { ticked: Record<string, string> };
    const { ticked } = press();
    expect(Object.keys(ticked)).toEqual(['walk']);
    expect(Number.isNaN(Date.parse(ticked.walk))).toBe(false);

    const after = render({ ...list, ticked });
    const walk = nodes(after).find((n) => children(n).includes('Example walk'))!;
    // As in the app: the title dims and nothing is struck through in full color.
    expect(mods(walk)).toContainEqual({ modifier: 'foregroundStyle', args: ['#B8B0A6'] });
    expect(mods(walk)).toContainEqual({
      modifier: 'strikethrough',
      args: [{ isActive: false, pattern: 'solid' }],
    });
    const check = nodes(after).filter((n) => n.type === 'Image')[0];
    expect(check.props).toMatchObject({ systemName: 'checkmark.circle.fill', color: '#5FD3A6' });
    // Where the system recolors the widget, the struck title says done in place of the color.
    const tinted = render({ ...list, ticked }, 'accented');
    expect(
      mods(nodes(tinted).find((n) => children(n).includes('Example walk'))!).find(
        (m) => m.modifier === 'strikethrough',
      )!.args[0],
    ).toMatchObject({ isActive: true });
    const again = nodes(after).find((n) => n.type === 'Button')!;
    expect(mods(again)).toContainEqual({
      modifier: 'accessibilityLabel',
      args: ['Undo Example walk'],
    });
    expect((again.props.onPress as () => { ticked: object })()).toEqual({ ticked: {} });
    // A task done in the app looks the same, and is not a button.
    const read = nodes(after).find((n) => children(n).includes('Example reading'))!;
    expect(mods(read)).toContainEqual({ modifier: 'foregroundStyle', args: ['#B8B0A6'] });
    const readTinted = nodes(tinted).find((n) => children(n).includes('Example reading'))!;
    expect(mods(readTinted).find((m) => m.modifier === 'strikethrough')!.args[0]).toMatchObject({
      isActive: true,
    });
  });

  test('a row that records something opens the app and says so; a done row does not', () => {
    const tree = render(list);
    const workout = nodes(tree).find((n) =>
      mods(n).some(
        (m) =>
          m.modifier === 'accessibilityLabel' &&
          m.args[0] === 'Example workout, 5:30 PM, not done, opens Life OS to record it',
      ),
    )!;
    expect(symbols(workout)).toEqual(['circle', 'chevron.right']);
    const read = nodes(tree).find((n) =>
      mods(n).some(
        (m) => m.modifier === 'accessibilityLabel' && m.args[0] === 'Example reading, done',
      ),
    )!;
    expect(symbols(read)).toEqual(['checkmark.circle.fill']);
    // Times keep one line in fixed-width digits, ahead of the title when space runs out.
    expect(names(holding(tree, '5:30 PM'))).toEqual(
      expect.arrayContaining(['monospacedDigit', 'layoutPriority', 'privacySensitive']),
    );
    // Text grows with the system size, up to where seven rows and the foot still fit.
    expect(mods(tree)).toContainEqual({ modifier: 'dynamicTypeSize', args: [{ max: 'xxLarge' }] });
  });

  test('a grey line says the list is done, only when every row is and nothing is left off', () => {
    const allDone: TodayListProps = {
      ...list,
      tasks: list.tasks.map((t) => (t.tap ? t : { ...t, done: true as const, tap: undefined })),
      more: undefined,
    };
    // The one-tap row ticked on the widget, still waiting for the app, counts as done here.
    const tree = render({ ...allDone, ticked: { walk: '2026-11-09T14:00:00.000Z' } });
    expect(texts(tree).at(-1)).toBe('All done on this list');
    expect(mods(holding(tree, 'All done on this list'))).toContainEqual({
      modifier: 'foregroundStyle',
      args: [tokens.dark.label2],
    });
    expect(texts(render(allDone))).not.toContain('All done on this list');
    expect(
      texts(render({ ...allDone, ticked: { walk: '2026-11-09T14:00:00.000Z' }, more: 1 })),
    ).not.toContain('All done on this list');
    expect(texts(render({ ...list, tasks: [] }))).not.toContain('All done on this list');
    // The list never speaks of the day: Day Cleared is the Today widget's opt-in alone.
    for (const props of [
      list,
      allDone,
      { ...allDone, ticked: { walk: 'x' } },
      { ...list, stale: true as const },
    ])
      for (const mode of ['fullColor', 'accented'])
        expect(JSON.stringify(render(props, mode))).not.toMatch(/clear|streak|\d+ of \d+/i);
  });

  test('light and dark follow the Home Screen; Always On outlines the checks', () => {
    const ticked = { walk: '2026-11-09T14:00:00.000Z' };
    const background = (tree: Node) =>
      (
        mods(tree).find((m) => m.modifier === 'containerBackground')!.args[0] as {
          colors: string[];
        }
      ).colors;
    const lightTree = render({ ...list, ticked }, 'fullColor', { colorScheme: 'light' });
    expect(background(lightTree)).toEqual([tokens.light.surface, tokens.light.canvas]);
    expect(nodes(lightTree).find((n) => n.type === 'Image')!.props.color).toBe(tokens.light.done);
    expect(mods(holding(lightTree, 'Example workout'))).toContainEqual({
      modifier: 'foregroundStyle',
      args: [tokens.light.label],
    });
    expect(background(render(list))).toEqual([tokens.dark.surface, tokens.dark.canvas]);
    // A done row's time keeps the full secondary color, which meets 4.5:1 on both palettes; the
    // struck title already says it is done.
    const doneTimed: TodayListProps = {
      ...list,
      tasks: [{ id: 'lift', title: 'Example workout', time: '5:30 PM', done: true }],
    };
    for (const [scheme, secondary] of [
      ['light', tokens.light.label2],
      ['dark', tokens.dark.label2],
    ]) {
      const time = holding(render(doneTimed, 'fullColor', { colorScheme: scheme }), '5:30 PM');
      expect(mods(time)).toContainEqual({ modifier: 'foregroundStyle', args: [secondary] });
      expect(names(time)).not.toContain('opacity');
    }
    const dim = render({ ...list, ticked }, 'fullColor', { isLuminanceReduced: true });
    for (const image of nodes(dim).filter((n) => n.type === 'Image'))
      expect(names(image)).not.toContain('shadow');
    expect(symbols(dim)).toEqual([
      'checkmark.circle',
      'circle',
      'chevron.right',
      'checkmark.circle',
    ]);
    const standBy = render({ ...list, ticked }, 'fullColor', { showsContainerBackground: false });
    for (const image of nodes(standBy).filter((n) => n.type === 'Image'))
      expect(names(image)).not.toContain('shadow');
  });

  test('titles and times are privacy-sensitive; tinted mode drops color and glow', () => {
    const tree = render(list);
    for (const value of ['Example walk', '5:30 PM']) {
      const node = nodes(tree).find((n) => children(n).includes(value))!;
      expect(mods(node).map((m) => m.modifier)).toContain('privacySensitive');
    }
    for (const mode of ['accented', 'vibrant', 'WidgetRenderingMode.vibrant']) {
      const tinted = render({ ...list, ticked: { walk: '2026-11-09T14:00:00.000Z' } }, mode);
      for (const image of nodes(tinted).filter((n) => n.type === 'Image')) {
        expect(image.props.color).toBeUndefined();
        expect(mods(image).map((m) => m.modifier)).not.toContain('shadow');
      }
      for (const node of nodes(tinted))
        for (const m of mods(node).filter((x) => x.modifier === 'foregroundStyle'))
          expect(m.args[0]).toMatchObject({ type: 'hierarchical' });
    }
  });

  test('every word keeps 4.5:1 and every colored check 3:1 on its own ground, in both appearances', () => {
    const contrast = (a: string, b: string) => {
      const lum = (hex: string) => {
        const [r, g, b2] = [1, 3, 5].map((i) => {
          const v = parseInt(hex.slice(i, i + 2), 16) / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
      };
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const walk = (node: Node, under: string[]): [Node, string[]][] => {
      const own = mods(node).find((m) => m.modifier === 'background')?.args[0];
      const here = typeof own === 'string' ? [own] : under;
      return [
        [node, here],
        ...children(node).flatMap((child) =>
          child && typeof child === 'object' ? walk(child as Node, here) : [],
        ),
      ];
    };
    const failures: string[] = [];
    let checked = 0;
    for (const colorScheme of ['light', 'dark'])
      for (const props of [
        list,
        { ...list, ticked: { walk: '2026-11-09T14:00:00.000Z' } },
        { ...list, tasks: list.tasks.map((t) => ({ ...t, done: true as const })), more: undefined },
        { ...list, tasks: [] },
        { ...list, stale: true as const },
        {} as TodayListProps,
      ]) {
        const tree = render(props, 'fullColor', { colorScheme });
        const ground = (
          mods(tree).find((m) => m.modifier === 'containerBackground')!.args[0] as {
            colors: string[];
          }
        ).colors;
        for (const [node, under] of walk(tree, ground)) {
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
    expect(checked).toBeGreaterThan(50);
  });

  test('the next open row takes the Ember tone, and moves on once it is ticked', () => {
    const ground = (tree: Node, title: string) =>
      nodes(tree)
        .filter((n) => n.type === 'HStack' && JSON.stringify(n).includes(title))
        .at(-1)!;
    const tint = (tree: Node, title: string) =>
      mods(ground(tree, title)).find((m) => m.modifier === 'background')?.args;
    for (const [scheme, t] of [
      ['dark', tokens.dark],
      ['light', tokens.light],
    ] as const) {
      const before = render(list, 'fullColor', { colorScheme: scheme });
      expect(tint(before, 'Example walk')).toEqual([
        t.accentTint,
        { shape: 'roundedRectangle', cornerRadius: 12, roundedCornerStyle: 'continuous' },
      ]);
      expect(tint(before, 'Example workout')).toBeUndefined();
      expect(nodes(before).find((n) => n.type === 'Image')!.props.color).toBe(t.accent);
      // Ticked on the widget, the walk is done and the workout is next, its time in Ember.
      const after = render({ ...list, ticked: { walk: '2026-11-09T14:00:00.000Z' } }, 'fullColor', {
        colorScheme: scheme,
      });
      expect(tint(after, 'Example walk')).toBeUndefined();
      expect(tint(after, 'Example workout')?.[0]).toBe(t.accentTint);
      expect(mods(holding(after, '5:30 PM'))).toContainEqual({
        modifier: 'foregroundStyle',
        args: [t.accentText],
      });
      // Other open checks are drawn in the check edge, at 3:1.
      expect(
        nodes(
          render(
            { ...list, tasks: [...list.tasks, { id: 'x', title: 'Example x' }] },
            'fullColor',
            {
              colorScheme: scheme,
            },
          ),
        )
          .filter((n) => n.type === 'Image' && n.props.systemName === 'circle')
          .map((n) => n.props.color),
      ).toEqual([t.accent, t.checkEdge, t.checkEdge]);
    }
    // Every row done: nothing takes the tone.
    const done = render({
      ...list,
      tasks: list.tasks.map((task) => ({ ...task, done: true as const, tap: undefined })),
    });
    expect(nodes(done).some((n) => names(n).includes('background'))).toBe(false);
  });

  test('publishing carries ticks still waiting for the app, and skips an unchanged list', async () => {
    const mockUpdateTimeline = jest.fn();
    const stored = [
      {
        date: new Date(),
        props: { ...list, date: '2026-11-09', ticked: { walk: '2026-11-09T14:00:00.000Z' } },
      },
    ];
    const { read, publish } = listPublisher(async () => ({
      updateTimeline: (entries) => mockUpdateTimeline(entries),
      getTimeline: async () => stored,
    }));
    expect(await read()).toEqual([
      { date: '2026-11-09', id: 'walk', at: '2026-11-09T14:00:00.000Z' },
    ]);
    await publish(emptyState());
    await publish(emptyState());
    expect(mockUpdateTimeline).toHaveBeenCalledTimes(1);
  });
});
