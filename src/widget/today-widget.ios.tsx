import {
  AccessoryWidgetBackground,
  Divider,
  HStack,
  Image,
  ProgressView,
  Spacer,
  Text,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityElement,
  accessibilityHidden,
  accessibilityLabel,
  background,
  containerBackground,
  font,
  foregroundStyle,
  frame,
  kerning,
  labelsHidden,
  layoutPriority,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  padding,
  privacySensitive,
  progressViewStyle,
  shadow,
  shapes,
  tint,
  widgetAccentedRenderingMode,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import type { Widget, WidgetEnvironment } from 'expo-widgets';
import { State } from '../domain/model';
import { TodayWidgetProps, todayWidgetTimeline, widgetTimelineKey } from '../domain/widget';

// The bundler serializes only this function body into the widget extension: every constant and
// helper it uses must be declared inside it (see the expo-widgets 'widget' directive).
const TodayWidget = (props: TodayWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const family = environment.widgetFamily;
  // Infinity cannot cross the JSON bridge; any size larger than a widget fills the space.
  const fill = 10000;
  const today = 'personalos:///';

  // The Lock Screen shows only the morning anchor's time: never a block, a day status, a count or a
  // streak, so nothing on it can worry at night. The time is public by the user's choice, so it is
  // not privacy-sensitive. Without an anchor it says how to set one. iOS draws it in the Lock
  // Screen's own tint, so it sets no color; the time is in SF Rounded, as in the app. A tap opens
  // Today.
  if (
    family === 'accessoryInline' ||
    family === 'accessoryRectangular' ||
    family === 'accessoryCircular'
  ) {
    const time = typeof props.anchor === 'string' && props.anchor ? props.anchor : null;
    const spoken = time ? `Life OS. Up by ${time}.` : 'Life OS. No Up by time set.';
    const lock = [containerBackground('clear', 'widget'), widgetURL(today)];
    if (family === 'accessoryInline')
      return (
        <Text
          modifiers={[...lock, accessibilityLabel(time ? `Life OS. Up by ${time}.` : 'Life OS')]}>
          {time ? `Up by ${time}` : 'Life OS'}
        </Text>
      );
    if (family === 'accessoryCircular') {
      // No destructuring: its Babel helper would live outside this function.
      const parts = time ? time.split(' ') : [];
      const clock = parts[0];
      const meridiem = parts[1];
      return (
        <ZStack modifiers={[...lock, accessibilityElement('ignore'), accessibilityLabel(spoken)]}>
          <AccessoryWidgetBackground />
          {clock ? (
            <VStack spacing={0}>
              <Image systemName="sunrise.fill" size={11} />
              <Text
                modifiers={[
                  font({ textStyle: 'headline', weight: 'bold', design: 'rounded' }),
                  monospacedDigit(),
                  lineLimit(1),
                  minimumScaleFactor(0.6),
                ]}>
                {clock}
              </Text>
              {meridiem ? (
                <Text
                  modifiers={[
                    font({ textStyle: 'caption2', weight: 'semibold', design: 'rounded' }),
                  ]}>
                  {meridiem}
                </Text>
              ) : null}
            </VStack>
          ) : (
            <Image systemName="sunrise" size={20} />
          )}
        </ZStack>
      );
    }
    return time ? (
      <HStack
        spacing={8}
        modifiers={[
          ...lock,
          frame({ maxWidth: fill, maxHeight: fill, alignment: 'leading' }),
          accessibilityElement('ignore'),
          accessibilityLabel(spoken),
        ]}>
        <Image systemName="sunrise.fill" size={22} />
        <VStack alignment="leading" spacing={0}>
          <Text modifiers={[font({ textStyle: 'caption', weight: 'bold' }), kerning(1.2)]}>
            UP BY
          </Text>
          <Text
            modifiers={[
              font({ textStyle: 'title', weight: 'bold', design: 'rounded' }),
              monospacedDigit(),
              lineLimit(1),
              minimumScaleFactor(0.7),
            ]}>
            {time}
          </Text>
        </VStack>
        <Spacer />
      </HStack>
    ) : (
      <VStack
        alignment="leading"
        spacing={1}
        modifiers={[
          ...lock,
          frame({ maxWidth: fill, maxHeight: fill, alignment: 'leading' }),
          accessibilityElement('combine'),
        ]}>
        <Text modifiers={[font({ textStyle: 'headline' }), lineLimit(1), minimumScaleFactor(0.8)]}>
          Life OS
        </Text>
        <Text
          modifiers={[
            font({ textStyle: 'caption' }),
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            lineLimit(2),
          ]}>
          Set an Up by time in Programs
        </Text>
      </VStack>
    );
  }

  // Home Screen: small and medium.
  const small = family === 'systemSmall';
  // Tinted ("accented") and clear ("vibrant") Home Screens and StandBy at night remove the
  // background and recolor content: there the widget drops its colors and glow for hierarchical
  // styles, so text and symbols carry the meaning. Matched loosely, since the strings come from a
  // Swift description.
  const mode = String(environment.widgetRenderingMode ?? 'fullColor').toLowerCase();
  const full = !mode.includes('accent') && !mode.includes('vibrant');
  // Always On dims the screen: outlines instead of filled symbols, and no glow.
  const dim = environment.isLuminanceReduced === true;
  // StandBy and CarPlay show the widget without its background, larger and from further away.
  const bare =
    (environment as { showsContainerBackground?: boolean }).showsContainerBackground === false;
  const glow = full && !dim && !bare;
  const light = environment.colorScheme === 'light';
  // The app's Calm premium tokens (src/ui/theme.ts), copied here because this function travels
  // alone: a card that settles into the page, Ember for what leads, Fern for a cleared day only.
  const c = light
    ? {
        top: '#FFFFFF',
        bottom: '#F7F4EF',
        primary: '#1D1B18',
        secondary: '#5C564F',
        accent: '#AE4E18',
        accentText: '#994515',
        accentTint: '#FCEBDD',
        done: '#1C7A50',
        doneText: '#196B46',
        doneTint: '#E2F3E9',
        glow: '#1C7A5033',
      }
    : {
        top: '#1C1A18',
        bottom: '#100F0E',
        primary: '#F5F1EB',
        secondary: '#B8B0A6',
        accent: '#FF9A57',
        accentText: '#FFA86E',
        accentTint: '#3A2618',
        done: '#5FD3A6',
        doneText: '#6FDCB1',
        doneTint: '#15302A',
        glow: '#5FD3A680',
      };
  const tone = (color: string, level: 'primary' | 'secondary') =>
    full ? color : ({ type: 'hierarchical', style: level } as const);
  const loaded = typeof props.kind === 'string';
  const stale = props.kind === 'stale';
  // The anchor time shows on the Home Screen in the morning: before it today, and after midnight.
  const upBy = stale ? props.anchor : props.upBy;

  // Earned only: on this widget, Fern appears only when the day is cleared. A stale entry (after
  // midnight) always wins: yesterday's clear never shows as today's.
  if (loaded && !stale && props.day === 'cleared') {
    const seal = (size: number) => (
      <Image
        systemName={dim ? 'checkmark.seal' : 'checkmark.seal.fill'}
        size={size}
        color={full ? c.done : undefined}
        modifiers={[
          ...(glow ? [shadow({ radius: 12, color: c.glow })] : []),
          widgetAccentedRenderingMode('accented'),
          accessibilityHidden(true),
          privacySensitive(),
        ]}
      />
    );
    const words = (
      <VStack alignment="leading" spacing={2}>
        <Text
          modifiers={[
            font({ textStyle: bare ? 'title' : 'title2', weight: 'heavy', design: 'rounded' }),
            foregroundStyle(tone(c.doneText, 'primary')),
            lineLimit(1),
            minimumScaleFactor(0.75),
            privacySensitive(),
          ]}>
          Day cleared
        </Text>
        <Text
          modifiers={[
            font({ textStyle: 'subheadline', weight: 'medium' }),
            foregroundStyle(tone(c.secondary, 'secondary')),
            lineLimit(2),
            minimumScaleFactor(0.85),
            privacySensitive(),
          ]}>
          Everything due is done
        </Text>
      </VStack>
    );
    const cleared = [
      containerBackground(
        glow
          ? {
              type: 'radialGradient',
              colors: [c.doneTint, c.top],
              center: { x: 0.15, y: 0.1 },
              startRadius: 0,
              endRadius: small ? 200 : 340,
            }
          : c.top,
        'widget',
      ),
      widgetURL(today),
      frame({ maxWidth: fill, maxHeight: fill, alignment: small ? 'topLeading' : 'leading' }),
      accessibilityElement('ignore'),
      accessibilityLabel('Life OS. Day cleared. Everything due is done.'),
    ];
    return small ? (
      <VStack alignment="leading" spacing={0} modifiers={cleared}>
        {seal(38)}
        <Spacer />
        {words}
      </VStack>
    ) : (
      <HStack spacing={16} modifiers={cleared}>
        {seal(56)}
        {words}
        <Spacer />
      </HStack>
    );
  }

  // Every status has a symbol, so the day reads without color too.
  const status =
    !loaded || stale
      ? null
      : props.day === 'remaining'
        ? { symbol: 'circle.dashed', text: 'Objectives remaining' }
        : props.day === 'plan'
          ? { symbol: 'calendar.badge.clock', text: 'Open Life OS to plan today' }
          : props.day === 'unresolved'
            ? { symbol: 'circle.slash', text: 'All skipped · not cleared' }
            : props.day === 'protected'
              ? { symbol: 'shield', text: 'Day protected' }
              : props.day === 'empty'
                ? { symbol: 'moon', text: 'Nothing due today' }
                : props.day === 'absent'
                  ? { symbol: 'circle', text: 'Nothing recorded yet' }
                  : null;
  const scheduled = props.kind === 'now' || props.kind === 'next';
  const todo = !scheduled && !stale && typeof props.todo === 'string' ? props.todo : null;
  // What leads: the scheduled block, else the next objective on the list, else the day's status.
  const head = !loaded
    ? {
        label: 'LIFE OS',
        symbol: 'arrow.up.forward.app',
        lead: false,
        text: 'Open Life OS to show today',
      }
    : stale
      ? { label: 'NEW DAY', symbol: 'sunrise.fill', lead: false, text: 'Tap to load today' }
      : scheduled
        ? {
            label: props.kind === 'now' ? 'NOW' : 'NEXT',
            symbol: null,
            lead: true,
            text: props.title ?? '',
          }
        : todo
          ? { label: 'ON THE LIST', symbol: 'circle', lead: true, text: todo }
          : status
            ? { label: 'LIFE OS · TODAY', symbol: status.symbol, lead: false, text: status.text }
            : {
                label: 'LIFE OS · TODAY',
                symbol: 'calendar',
                lead: false,
                text:
                  props.kind === 'clear'
                    ? 'Nothing else scheduled today'
                    : 'Nothing scheduled today',
              };
  // The status sits under what leads, on medium only; small keeps one message.
  const footer = !small && status && head.text !== status.text ? status : null;
  const bar =
    props.kind === 'now' && typeof props.startsAt === 'string' && typeof props.endsAt === 'string'
      ? { lower: new Date(props.startsAt), upper: new Date(props.endsAt) }
      : null;
  const later =
    !small && scheduled && typeof props.later === 'string'
      ? { title: props.later, time: props.laterTime ?? '' }
      : null;
  // Times are SF Rounded with fixed-width digits, on one line, and give way to nothing: a long
  // title wraps or shortens first.
  const clock = (text: string, color: string, size: 'subheadline' | 'caption') => (
    <Text
      modifiers={[
        font({ textStyle: size, weight: 'semibold', design: 'rounded' }),
        monospacedDigit(),
        foregroundStyle(tone(color, 'secondary')),
        lineLimit(1),
        minimumScaleFactor(0.7),
        layoutPriority(1),
        privacySensitive(),
      ]}>
      {text}
    </Text>
  );
  // A kicker: a tracked tag, with a symbol before it and, on medium, the time after it. A status
  // symbol is redacted with its words (`secret`), so locked StandBy shows neither.
  const kicker = (
    text: string,
    symbol: string | null,
    color: string,
    time: string | null,
    secret = false,
  ) => (
    <HStack spacing={5}>
      {symbol ? (
        <Image
          systemName={symbol as 'circle'}
          size={11}
          color={full ? color : undefined}
          modifiers={[accessibilityHidden(true), ...(secret ? [privacySensitive()] : [])]}
        />
      ) : null}
      <Text
        modifiers={[
          font({ textStyle: 'caption', weight: 'bold' }),
          kerning(1.2),
          foregroundStyle(tone(color, 'secondary')),
          lineLimit(1),
        ]}>
        {text}
      </Text>
      {time ? (
        <Text
          modifiers={[
            font({ textStyle: 'caption', weight: 'bold' }),
            foregroundStyle(tone(color, 'secondary')),
            accessibilityHidden(true),
          ]}>
          ·
        </Text>
      ) : null}
      {time ? clock(time, color, 'caption') : null}
    </HStack>
  );
  // Medium carries the block's time in its kicker, so NEXT and THEN fit one above the other.
  const inline = !small && scheduled && props.time ? props.time : null;
  const main = (
    <VStack
      alignment="leading"
      spacing={3}
      modifiers={[frame({ maxWidth: fill, alignment: 'leading' })]}>
      {kicker(
        head.label,
        head.symbol,
        head.lead ? c.accentText : c.secondary,
        inline,
        !!status && head.text === status.text,
      )}
      <Text
        modifiers={[
          font({
            textStyle: bare ? 'title2' : small ? 'headline' : 'title3',
            weight: 'semibold',
          }),
          foregroundStyle(tone(c.primary, 'primary')),
          lineLimit(later ? 1 : small && upBy ? 2 : small ? 3 : 2),
          minimumScaleFactor(0.85),
          ...(loaded && !stale ? [privacySensitive()] : []),
        ]}>
        {head.text}
      </Text>
      {small && scheduled && props.time ? clock(props.time, c.secondary, 'subheadline') : null}
      {bar ? (
        <ProgressView
          timerInterval={bar}
          countsDown
          modifiers={[
            progressViewStyle('linear'),
            // The bar alone: no remaining-time label under it.
            labelsHidden(),
            tint(tone(c.accent, 'secondary')),
            accessibilityHidden(true),
          ]}
        />
      ) : null}
    </VStack>
  );
  const then = later ? (
    <VStack alignment="leading" spacing={3}>
      <Divider />
      {kicker('THEN', null, c.secondary, later.time || null)}
      <Text
        modifiers={[
          font({ textStyle: 'subheadline', weight: 'medium' }),
          foregroundStyle(tone(c.secondary, 'secondary')),
          lineLimit(1),
          minimumScaleFactor(0.85),
          privacySensitive(),
        ]}>
        {later.title}
      </Text>
    </VStack>
  ) : null;
  const foot = footer ? (
    <HStack spacing={6}>
      <Image
        systemName={footer.symbol as 'circle'}
        size={12}
        color={full ? c.secondary : undefined}
        modifiers={[accessibilityHidden(true), privacySensitive()]}
      />
      <Text
        modifiers={[
          font({ textStyle: 'caption', weight: 'medium' }),
          foregroundStyle(tone(c.secondary, 'secondary')),
          lineLimit(1),
          privacySensitive(),
        ]}>
        {footer.text}
      </Text>
    </HStack>
  ) : null;
  const sunrise = (size: number) => (
    <Image
      systemName={dim ? 'sunrise' : 'sunrise.fill'}
      size={size}
      color={full ? c.accent : undefined}
      modifiers={[accessibilityHidden(true)]}
    />
  );
  // The morning: on small a soft Ember capsule in the foot; on medium a panel beside the day.
  const tinted = full ? c.accentTint : ({ type: 'hierarchical', style: 'quaternary' } as const);
  const morningPill = upBy ? (
    <HStack
      spacing={5}
      modifiers={[
        padding({ horizontal: 9, vertical: 5 }),
        background(tinted, shapes.capsule({ roundedCornerStyle: 'continuous' })),
      ]}>
      {sunrise(11)}
      <Text
        modifiers={[
          font({ textStyle: 'caption', weight: 'semibold', design: 'rounded' }),
          monospacedDigit(),
          foregroundStyle(tone(c.accentText, 'primary')),
          lineLimit(1),
          minimumScaleFactor(0.8),
        ]}>
        {`Up by ${upBy}`}
      </Text>
    </HStack>
  ) : null;
  const morningPanel = upBy ? (
    <VStack
      spacing={3}
      modifiers={[
        padding({ horizontal: 10, vertical: 12 }),
        frame({ width: 112, maxHeight: fill }),
        background(
          tinted,
          shapes.roundedRectangle({ cornerRadius: 16, roundedCornerStyle: 'continuous' }),
        ),
      ]}>
      {sunrise(20)}
      <Text
        modifiers={[
          font({ textStyle: 'caption', weight: 'semibold' }),
          foregroundStyle(tone(c.accentText, 'secondary')),
          lineLimit(1),
        ]}>
        Up by
      </Text>
      <Text
        modifiers={[
          font({ textStyle: 'title3', weight: 'bold', design: 'rounded' }),
          monospacedDigit(),
          foregroundStyle(tone(c.primary, 'primary')),
          lineLimit(1),
          minimumScaleFactor(0.6),
        ]}>
        {upBy}
      </Text>
    </VStack>
  ) : null;
  const ground = [
    containerBackground(
      {
        type: 'linearGradient',
        colors: [c.top, c.bottom],
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 1, y: 1 },
      },
      'widget',
    ),
    widgetURL(today),
    frame({ maxWidth: fill, maxHeight: fill, alignment: 'topLeading' }),
    accessibilityElement('combine'),
  ];
  if (small)
    return (
      <VStack alignment="leading" spacing={4} modifiers={ground}>
        {main}
        <Spacer />
        {morningPill}
      </VStack>
    );
  return (
    <HStack alignment="top" spacing={12} modifiers={ground}>
      <VStack
        alignment="leading"
        spacing={8}
        modifiers={[frame({ maxWidth: fill, maxHeight: fill, alignment: 'topLeading' })]}>
        {main}
        {then}
        <Spacer />
        {foot}
      </VStack>
      {morningPanel}
    </HStack>
  );
};

/** For tests: the layout the extension evaluates, a string after the widgets Babel plugin. */
export const todayWidgetLayout: unknown = TodayWidget;

type TimelineTarget = Pick<Widget<TodayWidgetProps>, 'updateTimeline'>;

/**
 * Publishes today's timeline, skipping a reload that would show exactly what is already stored.
 * The loader is injected so the skip-and-retry behavior can be tested without the native module.
 */
export function timelinePublisher(load: () => Promise<TimelineTarget>) {
  let widget: Promise<TimelineTarget> | null = null;
  let published: string | null = null;
  return async (state: State): Promise<void> => {
    widget ??= load();
    const entries = todayWidgetTimeline(state, new Date());
    const key = widgetTimelineKey(entries);
    if (key === published) return;
    (await widget).updateTimeline(entries);
    published = key;
  };
}

// `expo-widgets` is imported on the first publish, not at start, so a build without its native
// module still loads and saves. A failed import is kept: every later publish fails at once, and the
// app ignores widget failures. `@expo/ui`, which the layouts above use, loads at start.
export const publishTodayWidget = timelinePublisher(() =>
  import('expo-widgets').then(({ createWidget }) =>
    createWidget<TodayWidgetProps>('TodayWidget', TodayWidget),
  ),
);
