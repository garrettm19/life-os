import { ReactNode, useRef, useState } from 'react';
import { ColorValue, GestureResponderEvent, Platform, Text, View } from 'react-native';
import { nearestIndex, readoutPlace, stepIndex } from './chart-scale';
import { LinkButton, styles } from './components';
import { fonts, palette, radius, type } from './theme';

// The frame every Progress chart shares: a title, the plain-language headline, the plot, Show as
// list, and a caption saying what the chart counts. A touch on the plot moves a crosshair that
// snaps to the nearest point or column, read out in a box over the top of the plot, on the side
// away from the finger; releasing keeps it until the next touch or a tap elsewhere on the card.
// The box overlays the plot, so the card keeps no empty band for it and nothing moves while a
// finger reads. The list shows the same entries in words, so no value needs the touch to be read.

/** One selectable position of a chart (a point's date or a week's column), in words. */
export type ChartEntry = {
  /** A stable identity (a date), so the selection survives a range change while it is shown. */
  key: string;
  /** The value first: "179.8 lb", "63%". */
  value: string;
  /** Then the date or week: "Wed, Oct 7", "Week of Sep 28". */
  label: string;
  /** More lines for the readout: the sets of a session, the week's sessions. */
  detail?: string[];
  /** A week with nothing recorded: a position on the axis, but not a row in the list. */
  gap?: boolean;
};

/**
 * An entry as one sentence: the value, the date, then each detail. The readout, the list row and
 * VoiceOver's step through the chart all say the same, so no one hears less than the eye sees.
 */
export function entryWords(entry: ChartEntry): string {
  return `${entry.value}, ${entry.label}${entry.detail?.length ? `. ${entry.detail.join('. ')}` : ''}`;
}

/** What the plot's one accessible element says: the chart, then the selected point. */
export type ChartAccess = { label: string; value: string };

type Plot = (
  selected: number | null,
  onSelect: (index: number) => void,
  access: ChartAccess,
  /** The selected entry, for the chart to read out over its plot. */
  reading: ChartEntry | null,
) => ReactNode;

const KEYS: Record<string, 'next' | 'previous' | 'first' | 'last'> = {
  ArrowRight: 'next',
  ArrowUp: 'next',
  ArrowLeft: 'previous',
  ArrowDown: 'previous',
  Home: 'first',
  End: 'last',
};

/**
 * The touch layer over a plot, and its one accessible element. The whole plot height takes the
 * touch, and dragging moves the selection to the nearest position. For VoiceOver it is adjustable:
 * swiping up or down steps through the points and reads each one; in the browser it is a slider
 * that the arrow keys step. One element instead of a button per point keeps a year of weigh-ins
 * light, and Show as list reads them all.
 */
export function Scrub({
  left,
  width,
  height,
  positions,
  selected,
  onSelect,
  access,
}: {
  left: number;
  width: number;
  height: number;
  /** The x of each selectable position, from the chart's left edge. */
  positions: number[];
  selected: number | null;
  onSelect: (index: number) => void;
  access: ChartAccess;
}) {
  // The chart's left edge on the page, read when the touch starts: `locationX` is relative to
  // whatever view is under the finger, `pageX` is not.
  const origin = useRef(0);
  const pick = (e: GestureResponderEvent) =>
    onSelect(nearestIndex(positions, e.nativeEvent.pageX - origin.current));
  const step = (to: 'next' | 'previous' | 'first' | 'last') =>
    onSelect(stepIndex(selected, positions.length, to));
  const keys =
    Platform.OS === 'web'
      ? {
          onKeyDown: (e: { key: string; preventDefault: () => void }) => {
            const to = KEYS[e.key];
            if (!to) return;
            e.preventDefault();
            step(to);
          },
        }
      : {};
  return (
    <View
      testID="chart-scrub"
      accessible
      focusable
      accessibilityRole="adjustable"
      accessibilityLabel={access.label}
      accessibilityValue={{ text: access.value }}
      aria-valuetext={access.value}
      accessibilityHint="Swipe up or down to read each point."
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) =>
        step(e.nativeEvent.actionName === 'increment' ? 'next' : 'previous')
      }
      {...keys}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      // A vertical swipe still scrolls the page; the readout keeps the last position.
      onResponderTerminationRequest={() => true}
      onResponderGrant={(e) => {
        origin.current = e.nativeEvent.pageX - e.nativeEvent.locationX - left;
        pick(e);
      }}
      onResponderMove={pick}
      style={{ position: 'absolute', left, top: 0, width, height }}
    />
  );
}

/**
 * The value, then the date or week on its own line, then the details. The value is in rounded
 * tabular figures (`type.value`), so how far it runs depends on its length alone; the date never
 * shares its line, so no reading wraps where a slightly wider one would not.
 */
function EntryText({ entry }: { entry: ChartEntry }) {
  return (
    <>
      <Text style={{ ...type.value, fontSize: 16, lineHeight: 21 }}>{entry.value}</Text>
      <Text style={type.caption}>{entry.label}</Text>
      {entry.detail?.map((line) => (
        <Text key={line} style={type.caption}>
          {line}
        </Text>
      ))}
    </>
  );
}

/**
 * The selected entry, value first, in a box over the top of the plot, anchored to the edge away
 * from the selected position `x` and at most half the chart wide, so it never covers the point it
 * reads. It overlays the plot instead of taking a band above it, so the plot never moves under
 * the finger and an untouched card is no taller than its chart. Nothing shows before a touch.
 */
export function Readout({
  entry,
  x,
  width,
}: {
  entry: ChartEntry | null;
  /** The selected position, from the chart's left edge. */
  x: number;
  /** The chart's width. */
  width: number;
}) {
  if (!entry) return null;
  const { side, maxWidth } = readoutPlace(x, width);
  return (
    // Not a live region: the chart's own element already reads the selected point to VoiceOver.
    <View
      testID="chart-readout"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={{
        position: 'absolute',
        top: 0,
        [side]: 0,
        maxWidth,
        gap: 1,
        paddingVertical: 6,
        paddingHorizontal: 8,
        borderRadius: radius.check,
        borderWidth: 1,
        borderColor: palette.edge,
        backgroundColor: palette.fill,
      }}>
      <EntryText entry={entry} />
    </View>
  );
}

/** The same entries as rows, newest first, each read as one element. */
function EntryList({ entries }: { entries: ChartEntry[] }) {
  const rows = entries.filter((e) => !e.gap).reverse();
  return (
    <View testID="chart-list" style={{ gap: 0 }}>
      {rows.map((e) => (
        <View
          key={e.key}
          accessible
          accessibilityLabel={entryWords(e)}
          style={{
            minHeight: 44,
            paddingVertical: 8,
            borderTopWidth: 1,
            borderTopColor: palette.separator,
            gap: 2,
            justifyContent: 'center',
          }}>
          <View style={[styles.spread, { gap: 8 }]}>
            <Text style={{ ...type.caption, color: palette.label2, flexShrink: 1 }}>{e.label}</Text>
            <Text style={{ ...fonts.figure, fontSize: 14, color: palette.label }}>{e.value}</Text>
          </View>
          {e.detail?.map((line) => (
            <Text key={line} style={type.caption}>
              {line}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/** A series key: a short stroke (a line) or a square (columns) beside its name, never colored text. */
export function Key({
  color,
  title,
  shape = 'line',
  value,
}: {
  color: ColorValue;
  title: string;
  shape?: 'line' | 'square' | 'dot';
  value?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={
          shape === 'line'
            ? { width: 14, height: 2, borderRadius: 1, backgroundColor: color }
            : shape === 'dot'
              ? { width: 8, height: 8, borderRadius: 4, backgroundColor: color }
              : { width: 9, height: 9, borderRadius: 2, backgroundColor: color }
        }
      />
      <Text style={{ ...type.caption, color: palette.label2 }}>
        {title}
        {value ? (
          <Text style={{ ...fonts.figure, color: palette.label }}>{` ${value}`}</Text>
        ) : null}
      </Text>
    </View>
  );
}

export function Keys({ children }: { children: ReactNode }) {
  return <View style={[styles.row, { columnGap: 14, rowGap: 4 }]}>{children}</View>;
}

/**
 * A Progress chart card. With fewer than two points (`state` sparse or empty) it shows only the
 * headline and one line, never an empty chart frame, and no caption for a chart it does not draw.
 */
export function ChartCard({
  testID,
  title,
  headline,
  summary,
  state,
  note,
  entries,
  plot,
  controls,
  keys,
  caption,
  footer,
}: {
  testID: string;
  title: string;
  headline: string;
  /** For VoiceOver: the headline and the range. */
  summary: string;
  state: 'empty' | 'sparse' | 'chart';
  note: string | null;
  entries: ChartEntry[];
  plot: Plot;
  /** Above the headline: the lift or activity chips. */
  controls?: ReactNode;
  /** The series keys, above the plot. */
  keys?: ReactNode;
  /** What the chart counts, under it: shown only with the chart. */
  caption?: string;
  /** Under everything, whatever the state: a stale check-in, an unfinished workout. */
  footer?: ReactNode;
}) {
  const [key, setKey] = useState<string | null>(null);
  const [list, setList] = useState(false);
  const [about, setAbout] = useState(false);
  const index = entries.findIndex((e) => e.key === key);
  const selected = index < 0 ? null : index;
  const chart = state === 'chart';
  return (
    <View
      testID={testID}
      // A tap anywhere on the card but the plot or a control clears the readout.
      onStartShouldSetResponder={() => selected !== null}
      onResponderRelease={() => setKey(null)}
      style={[styles.card, { gap: 12 }]}>
      {/* The card's subject, small; the headline under it says what the chart shows. */}
      <Text maxFontSizeMultiplier={1.3} style={{ ...type.meta, color: palette.label2 }}>
        {title}
      </Text>
      {controls}
      <Text accessibilityRole="header" style={{ ...type.heading, marginTop: -6 }}>
        {headline}
      </Text>
      {!chart ? (
        !!note && <Text style={styles.muted}>{note}</Text>
      ) : (
        <>
          {keys}
          {list ? (
            <EntryList entries={entries} />
          ) : (
            plot(
              selected,
              (i) => setKey(entries[i]?.key ?? null),
              {
                // The chart's summary, then the point it is on, in the readout's own words.
                label: summary,
                value: selected === null ? 'No point selected' : entryWords(entries[selected]),
              },
              selected === null ? null : entries[selected],
            )
          )}
          <View style={[styles.row, { columnGap: 18 }]}>
            <LinkButton
              tone="dim"
              title={list ? 'Show as chart' : 'Show as list'}
              label={`${list ? 'Show as chart' : 'Show as list'}: ${title}`}
              onPress={() => setList(!list)}
            />
            {/* What the chart counts, folded: the headline and the plot say enough at a glance. */}
            {!!caption && (
              <LinkButton
                tone="dim"
                title={about ? 'Hide note' : 'About this chart'}
                label={`${about ? 'Hide note' : 'About this chart'}: ${title}`}
                expanded={about}
                onPress={() => setAbout(!about)}
              />
            )}
          </View>
          {!!caption && about && (
            <Text testID="chart-note" style={type.footnote}>
              {caption}
            </Text>
          )}
        </>
      )}
      {footer}
    </View>
  );
}
