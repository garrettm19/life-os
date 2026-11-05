import { Button, HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityElement,
  accessibilityHidden,
  accessibilityLabel,
  background,
  buttonStyle,
  containerBackground,
  dynamicTypeSize,
  font,
  foregroundStyle,
  frame,
  kerning,
  layoutPriority,
  lineLimit,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  privacySensitive,
  shadow,
  shapes,
  strikethrough,
  widgetAccentedRenderingMode,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import type { Widget, WidgetEnvironment, WidgetTimelineEntry } from 'expo-widgets';
import { State } from '../domain/model';
import { widgetTimelineKey } from '../domain/widget';
import { TodayListProps, WidgetTick, ticksIn, todayListTimeline } from '../domain/widget-list';

// The bundler serializes only this function body into the widget extension: every constant and
// helper it uses must be declared inside it (see the expo-widgets 'widget' directive).
const TodayListWidget = (props: TodayListProps, environment: WidgetEnvironment) => {
  'widget';
  // Infinity cannot cross the JSON bridge; any size larger than a widget fills the space.
  const fill = 10000;
  // Tinted ("accented") and clear ("vibrant") Home Screens and StandBy at night recolor content:
  // hierarchical styles and no glow there. Matched loosely, since the strings come from a Swift
  // description.
  const mode = String(environment.widgetRenderingMode ?? 'fullColor').toLowerCase();
  const full = !mode.includes('accent') && !mode.includes('vibrant');
  // Always On dims the screen: outlined checks and no glow.
  const dim = environment.isLuminanceReduced === true;
  const bare =
    (environment as { showsContainerBackground?: boolean }).showsContainerBackground === false;
  const glow = full && !dim && !bare;
  const light = environment.colorScheme === 'light';
  // The app's Calm premium tokens (src/ui/theme.ts), copied here because this function travels
  // alone. Ember marks the next row, Fern a done check, as on Today.
  const c = light
    ? {
        top: '#FFFFFF',
        bottom: '#F7F4EF',
        primary: '#1D1B18',
        secondary: '#5C564F',
        open: '#8C847B',
        accent: '#AE4E18',
        accentText: '#994515',
        accentTint: '#FCEBDD',
        done: '#1C7A50',
        glow: '#1C7A5033',
      }
    : {
        top: '#1C1A18',
        bottom: '#100F0E',
        primary: '#F5F1EB',
        secondary: '#B8B0A6',
        open: '#7E766D',
        accent: '#FF9A57',
        accentText: '#FFA86E',
        accentTint: '#3A2618',
        done: '#5FD3A6',
        glow: '#5FD3A680',
      };
  const tone = (color: string, level: 'primary' | 'secondary') =>
    full ? color : ({ type: 'hierarchical', style: level } as const);
  const loaded = typeof props.date === 'string' && Array.isArray(props.tasks);
  const stale = loaded && props.stale === true;
  const ticked = props.ticked ?? {};
  const tasks = loaded && !stale ? props.tasks : [];
  const isDone = (task: TodayListProps['tasks'][number]) => !!task.done || !!ticked[task.id];
  // The next thing to do on this list takes the Ember tone, as the app's next row does.
  const firstOpen = tasks.find((task) => !isDone(task));
  const nextId = firstOpen ? firstOpen.id : null;

  const row = (task: TodayListProps['tasks'][number]) => {
    const done = isDone(task);
    const next = task.id === nextId;
    // A row that records something (a workout, a review) opens the app; the chevron says so.
    const opens = !task.tap && !done;
    const circle = (
      <Image
        systemName={done ? (dim ? 'checkmark.circle' : 'checkmark.circle.fill') : 'circle'}
        size={22}
        color={full ? (done ? c.done : next ? c.accent : c.open) : undefined}
        modifiers={[
          ...(done && glow ? [shadow({ radius: 6, color: c.glow })] : []),
          widgetAccentedRenderingMode('accented'),
          // A larger target than the circle, without taller rows.
          frame({ width: 30, height: 28 }),
          accessibilityHidden(true),
        ]}
      />
    );
    // Done dims the title and lets the Fern check say it, as in the app. Where the system recolors
    // the widget (tinted, clear) the check's color is gone, so the title is struck through there.
    const words = (
      <Text
        modifiers={[
          font({ textStyle: 'body', weight: done ? 'regular' : next ? 'semibold' : 'medium' }),
          foregroundStyle(tone(done ? c.secondary : c.primary, done ? 'secondary' : 'primary')),
          strikethrough({ isActive: done && !full, pattern: 'solid' }),
          lineLimit(1),
          privacySensitive(),
        ]}>
        {task.title}
      </Text>
    );
    const time = task.time ? (
      <Text
        modifiers={[
          font({ textStyle: 'footnote', weight: 'semibold', design: 'rounded' }),
          monospacedDigit(),
          // Never faded: the secondary color keeps 4.5:1, and the check already says done.
          foregroundStyle(tone(next ? c.accentText : c.secondary, 'secondary')),
          lineLimit(1),
          layoutPriority(1),
          privacySensitive(),
        ]}>
        {task.time}
      </Text>
    ) : null;
    const chevron = opens ? (
      <Image
        systemName="chevron.right"
        size={11}
        color={full ? c.secondary : undefined}
        modifiers={[accessibilityHidden(true)]}
      />
    ) : null;
    const when = task.time ? `, ${task.time}` : '';
    // The next row sits on a soft Ember ground, inset like the app's row in progress.
    const place = [
      frame({ maxWidth: fill, alignment: 'leading' }),
      padding({ horizontal: 6, vertical: 2 }),
      ...(next
        ? [
            background(
              full ? c.accentTint : { type: 'hierarchical', style: 'quaternary' },
              shapes.roundedRectangle({ cornerRadius: 12, roundedCornerStyle: 'continuous' }),
            ),
          ]
        : []),
    ];
    // Only the circle of a one-tap objective still open in the app is a button, named as in the
    // app; a tap anywhere else opens Today. A second tap takes back a tick the app has not
    // recorded yet.
    if (task.tap)
      return (
        <HStack key={task.id} spacing={8} modifiers={place}>
          <Button
            target={task.id}
            modifiers={[
              buttonStyle('plain'),
              accessibilityLabel(
                ticked[task.id] ? `Undo ${task.title}${when}` : `Mark ${task.title} done${when}`,
              ),
            ]}
            onPress={() => {
              const updated = { ...ticked };
              if (updated[task.id]) delete updated[task.id];
              else updated[task.id] = new Date().toISOString();
              return { ticked: updated };
            }}>
            {circle}
          </Button>
          <VStack modifiers={[accessibilityHidden(true)]}>{words}</VStack>
          <Spacer />
          {time ? <VStack modifiers={[accessibilityHidden(true)]}>{time}</VStack> : null}
        </HStack>
      );
    return (
      <HStack
        key={task.id}
        spacing={8}
        modifiers={[
          ...place,
          accessibilityElement('ignore'),
          accessibilityLabel(
            `${task.title}${when}, ${done ? 'done' : 'not done, opens Life OS to record it'}`,
          ),
        ]}>
        {circle}
        {words}
        <Spacer />
        {time}
        {chevron}
      </HStack>
    );
  };

  const message = !loaded
    ? 'Open Life OS to show today’s list'
    : stale
      ? 'Tap to load today'
      : tasks.length === 0
        ? 'Nothing left on the list today'
        : null;
  // Every row done, ticks waiting for the app included, and nothing left off the list. Grey and
  // worded about this list only: it is never Day Cleared, which this widget does not know.
  const allDone = tasks.length > 0 && !props.more && tasks.every(isDone);
  const quiet = (text: string) => (
    <Text
      modifiers={[
        font({ textStyle: 'caption', weight: 'medium' }),
        foregroundStyle(tone(c.secondary, 'secondary')),
        padding({ horizontal: 6 }),
      ]}>
      {text}
    </Text>
  );
  return (
    <VStack
      alignment="leading"
      spacing={6}
      modifiers={[
        containerBackground(
          {
            type: 'linearGradient',
            colors: [c.top, c.bottom],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 },
          },
          'widget',
        ),
        widgetURL('personalos:///'),
        // Larger text sizes still apply, up to the size where seven rows and the foot still fit.
        dynamicTypeSize({ max: 'xxLarge' }),
        frame({ maxWidth: fill, maxHeight: fill, alignment: 'topLeading' }),
      ]}>
      <HStack spacing={6} modifiers={[padding({ horizontal: 6, bottom: 2 })]}>
        {stale ? (
          <Image
            systemName={dim ? 'sunrise' : 'sunrise.fill'}
            size={12}
            color={full ? c.accent : undefined}
            modifiers={[accessibilityHidden(true)]}
          />
        ) : null}
        <Text
          modifiers={[
            font({ textStyle: 'caption', weight: 'bold' }),
            kerning(1.4),
            foregroundStyle(tone(c.accentText, 'secondary')),
          ]}>
          {stale ? 'NEW DAY' : 'TODAY'}
        </Text>
        <Spacer />
        {loaded && !stale ? (
          <Text
            modifiers={[
              font({ textStyle: 'caption', weight: 'semibold', design: 'rounded' }),
              foregroundStyle(tone(c.secondary, 'secondary')),
            ]}>
            {props.label ?? ''}
          </Text>
        ) : null}
      </HStack>
      {message ? <Spacer /> : null}
      {message ? (
        <Text
          modifiers={[
            font({ textStyle: 'headline' }),
            foregroundStyle(tone(loaded && !stale ? c.secondary : c.primary, 'primary')),
            multilineTextAlignment('center'),
            frame({ maxWidth: fill, alignment: 'center' }),
          ]}>
          {message}
        </Text>
      ) : (
        tasks.map(row)
      )}
      <Spacer />
      {allDone ? quiet('All done on this list') : null}
      {loaded && !stale && props.more ? quiet(`+${props.more} more in Life OS`) : null}
    </VStack>
  );
};

/** For tests: the layout the extension evaluates, a string after the widgets Babel plugin. */
export const todayListLayout: unknown = TodayListWidget;

type ListTarget = Pick<Widget<TodayListProps>, 'updateTimeline' | 'getTimeline'>;

/**
 * Reads ticks made on the widget, then publishes today's list with the ticks still waiting for
 * the app carried over, skipping a reload that would show what is already stored.
 */
export function listPublisher(load: () => Promise<ListTarget>) {
  let widget: Promise<ListTarget> | null = null;
  let published: string | null = null;
  const read = async (): Promise<WidgetTick[]> => {
    widget ??= load();
    return ticksIn((await (await widget).getTimeline()) as WidgetTimelineEntry<TodayListProps>[]);
  };
  const publish = async (state: State): Promise<void> => {
    const pending = await read();
    const entries = todayListTimeline(state, new Date(), pending);
    const key = widgetTimelineKey(entries as never);
    if (key === published) return;
    (await widget!).updateTimeline(entries);
    published = key;
  };
  return { read, publish };
}

// `expo-widgets` is imported on the first read or publish, not at start, so a build without its
// native module still loads and saves. A failed import is kept: every later call fails at once, and
// the app ignores widget failures. `@expo/ui`, which the layouts above use, loads at start.
const todayList = listPublisher(() =>
  import('expo-widgets').then(({ createWidget }) =>
    createWidget<TodayListProps>('TodayListWidget', TodayListWidget),
  ),
);
export const publishTodayList = todayList.publish;
export const readWidgetTicks = todayList.read;
