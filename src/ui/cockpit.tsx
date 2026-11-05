import { memo, useState } from 'react';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ColorValue, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SetupId, State, Timeframe } from '../domain/model';
import { DailyBias, directional } from '../domain/trading';
import {
  CHART_LINE,
  LINE_WORDS,
  Left,
  LineStatus,
  LiveContext,
  NOT_VERIFIED_LINE,
  SizeProblem,
  ThesisDraft,
  TradeSize,
  answerReset,
  assess,
  endSession,
  feelRushed,
  invalidateHtf,
  markLine,
  newThesis,
  newThesisProblem,
  recordExit,
  recordPartial,
  reportLoss,
  setRegime,
  sizeTrade,
} from '../domain/trading-live';
import {
  Attempt,
  CisdHow,
  EXCEPTION_MAX,
  LiveLimits,
  LossTotal,
  ObservedKind,
  WHERE_MAX,
  ZoneState,
} from '../domain/trading-live-model';
import { dollarText, parseContracts, parsePrice, priceText } from '../domain/trading-prices';
import { SETUPS } from '../domain/trading-rules';
import {
  StatusBasis,
  Tone,
  enterAttempt,
  logTakenAttempt,
  refuseEntry,
} from '../domain/trading-status';
import { CISD_CHOICES, CISD_RULE } from '../domain/trading-strategy';
import { useBusy } from '../state/app-state';
import { Button, chipStyle, Field, LinkButton, Sheet, styles } from './components';
import { Group, Row } from './list';
import { Tick } from './mission';
import { PressableScale } from './motion';
import { Glyph, GlyphName } from './settings-icon';
import {
  BIAS_LOOK,
  Bold,
  ChoiceRow,
  CockpitButton,
  GEX_LOOK,
  Look,
  OutlineButton,
  StopButton,
} from './trading-parts';
import { LiveWrite } from './use-live';
import { depth, fonts, market, palette, radius, type } from './theme';

// The live cockpit's parts: the status band, the four indicator tiles, the thesis strip, the setup
// and location controls, the outcome, reset and new-thesis actions, the cooldown and stop panels,
// and the small sheets (entry and stop, a new thesis, ending the session, a trade taken outside
// the cockpit). Every part takes plain values and the stable write, so a tap or a keystroke
// re-renders only the part it changes. Nothing here decides anything: the status and every
// refusal come from src/domain. Selections are neutral, never Fern (done) and never the bias
// color (which shows only on the HTF tile), so nothing reads as permission.

/** The neutral look of a selection or a primary in the cockpit. */
export const NEUTRAL: Look = {
  color: palette.label,
  deep: palette.fill,
  edge: palette.edge,
};
const AMBER: Look = { color: market.amber, deep: market.amberTint, edge: market.amberEdge };

/**
 * The band's family per tone: a solid fill with dark ink and a symbol, read like a road sign in
 * either appearance. Amber for a wait or a block (the symbol tells them apart), blue in position,
 * coral for a stop, stone once the checks are complete. The symbol and the title always go with
 * the color.
 */
const BAND: Record<Tone, { fill: ColorValue; glyph: GlyphName }> = {
  stop: { fill: market.bandStop, glyph: 'stop' },
  block: { fill: market.bandWait, glyph: 'block' },
  wait: { fill: market.bandWait, glyph: 'wait' },
  ready: { fill: market.bandReady, glyph: 'ready' },
  position: { fill: market.bandPosition, glyph: 'position' },
};

const BASIS_WORDS: Record<StatusBasis, string> = { app: 'App-level', report: 'Self-reported' };

/**
 * Props compared by value: the display-only blocks below take amounts and sizes read fresh on
 * every 30-second tick, so they re-render only when something they show changed.
 */
function sameValues(a: object, b: object): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A small word tag in a ringed capsule: PRACTICE, EXCEPTION. */
function Tag({ text, color }: { text: string; color: ColorValue }) {
  return (
    <Text
      style={{
        ...type.tag,
        color,
        borderWidth: 1.5,
        borderColor: color,
        borderRadius: radius.capsule,
        paddingHorizontal: 8,
        paddingVertical: 1,
        overflow: 'hidden',
      }}>
      {text}
    </Text>
  );
}

/**
 * A compact cockpit, on a phone narrower than 360 points or shorter than 700 (the smallest
 * iPhones): the band keeps its title and the next step and leaves its reason to `StatusReason`,
 * under the figures, and the tiles and figures take smaller sizes, so the band, the four tiles,
 * the figures and I FEEL RUSHED stay on the first screen, with larger text too.
 */
export function useCompactCockpit(): boolean {
  const { width, height } = useWindowDimensions();
  return width < 360 || height < 700;
}

/**
 * The status band, dominant and always on screen: a solid fill by family with dark ink, its symbol,
 * the title, why, and what to do next, each wrapping and never cut. It never says a trade is
 * approved. PRACTICE, the day's major event and whether the status rests on the app's records or
 * on the trader's own read are tagged above the title. On a compact cockpit (`compact`) the why
 * and the basis are shown in full under the figures instead (`StatusReason`), and the tag line
 * only while there is a tag, so the band, the four tiles and the figures stay on the first screen
 * with the next step whole.
 */
export const StatusBand = memo(function StatusBand({
  title,
  reason,
  next,
  tone,
  basis,
  practice,
  event,
  compact = false,
}: {
  title: string;
  reason: string;
  next: string;
  tone: Tone;
  basis: StatusBasis;
  practice: boolean;
  /** The day's major event, short ("FOMC 2:00 PM"), or null. */
  event?: string | null;
  compact?: boolean;
}) {
  const band = BAND[tone];
  const narrow = compact;
  const ink = market.onBand;
  return (
    <View
      testID="trade-status"
      accessible
      accessibilityLabel={`${practice ? 'Practice. ' : ''}${event ? `Major event today: ${event}. ` : ''}${title}. ${reason} Next: ${next} ${BASIS_WORDS[basis]}.`}
      accessibilityLiveRegion="polite"
      aria-live="polite"
      style={{
        gap: narrow ? 3 : 6,
        paddingHorizontal: narrow ? 12 : 16,
        paddingTop: narrow ? 8 : 12,
        paddingBottom: narrow ? 9 : 14,
        borderRadius: radius.tile,
        backgroundColor: band.fill,
      }}>
      {(!compact || practice || !!event) && (
        <View style={[styles.row, { gap: 6, rowGap: 4 }]}>
          {practice && <Tag text="PRACTICE" color={ink} />}
          {event && <Tag text={`EVENT · ${event}`} color={ink} />}
          {!compact && (
            <Text style={{ ...fonts.semibold, fontSize: 13, lineHeight: 18, color: ink }}>
              {BASIS_WORDS[basis]}
            </Text>
          )}
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: narrow ? 6 : 10 }}>
        <View
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: narrow ? 20 : 30,
            height: narrow ? 20 : 30,
            marginTop: narrow ? 0 : -2,
            borderRadius: radius.capsule,
            backgroundColor: market.bandMark,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Glyph name={band.glyph} color={ink} size={narrow ? 11 : 16} />
        </View>
        <Text
          testID="trade-status-title"
          style={{
            ...type.status,
            flex: 1,
            fontSize: narrow ? 15 : 20,
            lineHeight: narrow ? 19 : 26,
            color: ink,
          }}>
          {title}
        </Text>
      </View>
      {!compact && (
        <Text
          testID="trade-status-reason"
          style={{ ...fonts.regular, fontSize: 15, lineHeight: 20, color: ink }}>
          {reason}
        </Text>
      )}
      <Text
        testID="trade-status-next"
        style={{
          ...fonts.semibold,
          fontSize: narrow ? 13 : 15,
          lineHeight: narrow ? 17 : 20,
          color: ink,
        }}>
        <Text style={fonts.heavy}>Next: </Text>
        {next}
      </Text>
    </View>
  );
});

/**
 * The band's why and its basis, in full, under the figures on a compact cockpit, where the band
 * keeps its title and the next step. `reason` is null where the screen says it in full already.
 */
export function StatusReason({ reason, basis }: { reason: string | null; basis: StatusBasis }) {
  return (
    <View
      testID="trade-status-reason"
      style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 4 }}>
      <Text style={{ ...type.meta, color: palette.label2 }}>{reason ? 'Why' : 'Basis'}</Text>
      <Text style={{ ...type.caption, flex: 1, color: palette.label }}>
        {reason ? `${reason} ` : ''}
        <Text style={{ color: palette.label2 }}>{BASIS_WORDS[basis]}</Text>
      </Text>
    </View>
  );
}

/**
 * One indicator tile: a label and a value, icon and words, never color alone. A value in words (a
 * label typed in Preparation) wraps to a second line where there is room. `look` tints the tile
 * (the HTF plan in its bias); the others sit on the card color.
 */
function Tile({
  label,
  value,
  labelColor = palette.label2,
  color = palette.label,
  look,
  words = false,
  testID,
  spoken,
  lines = 1,
}: {
  /** Lines the value may wrap to. */
  lines?: number;
  /** The small line above the value: what it is, with a short detail. */
  label: string;
  value: string;
  labelColor?: ColorValue;
  color?: ColorValue;
  look?: Look;
  /** A value in words (a side, a label) rather than a figure. */
  words?: boolean;
  testID: string;
  spoken: string;
}) {
  const narrow = useCompactCockpit();
  const size = words ? (narrow ? 16 : 19) : narrow ? 18 : 22;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={spoken}
      style={{
        flexGrow: 1,
        flexBasis: 130,
        gap: narrow ? 0 : 2,
        paddingHorizontal: narrow ? 12 : 14,
        paddingVertical: narrow ? 5 : 10,
        borderRadius: radius.tile,
        ...(look
          ? { backgroundColor: look.deep, borderWidth: 1.5, borderColor: look.edge }
          : { backgroundColor: palette.surface, ...depth.card }),
      }}>
      <Text
        numberOfLines={1}
        style={{
          ...type.meta,
          ...(narrow && { fontSize: 12, lineHeight: 16 }),
          color: labelColor,
        }}>
        {label}
      </Text>
      <Text
        numberOfLines={lines}
        style={{
          ...(words ? fonts.bold : fonts.figureHeavy),
          fontSize: size,
          lineHeight: Math.round(size * 1.25),
          color,
        }}>
        {value}
      </Text>
    </View>
  );
}

/** A word from the records ("NORMAL", "bullish") in sentence case. */
const sentence = (word: string) => `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`;

const ARROW: Record<DailyBias, string> = { bullish: '▲', bearish: '▼', unclear: '–' };

/** "$150", "unknown" (never zero), with "(planned)" when part of it is an estimate. */
export function leftText(left: Left | null): string {
  if (!left) return '—';
  if (left.amount === null) return 'unknown';
  return `${dollarText(Math.max(left.amount, 0))}${left.planned ? ' (planned)' : ''}`;
}

/** The session's losses: "$90 (planned)", or unknown. */
function lossText(loss: LossTotal): string {
  if (loss.unknown) return 'unknown';
  return `${dollarText(loss.amount)}${loss.planned ? ' (planned)' : ''}`;
}

const LINE_LOOK: Record<LineStatus, { mark: string; color: ColorValue }> = {
  normal: { mark: '○', color: palette.label2 },
  warning: { mark: '△', color: market.amber },
  baiting: { mark: '⚠', color: market.amber },
  invalidated: { mark: '✕', color: palette.danger },
};

/**
 * The four indicators: the HTF plan, the target, the location with its line status, and the risk
 * per trade with the size the stop allows. The invalidation is read out with the target; the
 * Entry & stop sheet and Preparation show it. With copied accounts the risk per trade says it is
 * per account, and the size says the total is across them.
 */
export const Indicators = memo(function Indicators({
  bias,
  conditional,
  where,
  why,
  target,
  target2,
  invalidation,
  lineLabel,
  line,
  failures,
  tradeRisk,
  accounts,
  size,
  sizeProblem,
}: {
  bias: DailyBias | null;
  conditional: boolean;
  where: string;
  why: string;
  target: number | null;
  target2: number | null;
  invalidation: number | null;
  lineLabel: string;
  line: LineStatus;
  failures: number;
  tradeRisk: number | null;
  accounts: number;
  size: TradeSize | null;
  sizeProblem: SizeProblem | null;
}) {
  const biasLook = BIAS_LOOK[bias ?? 'none'];
  const biasWord = bias ? `${ARROW[bias]} ${sentence(bias)}` : 'Not set';
  const mode = !directional(bias)
    ? 'No trade'
    : conditional
      ? `Into ${where} → look for ${ARROW[bias]}`
      : 'All day';
  const compact = useCompactCockpit();
  const lineLook = LINE_LOOK[line];
  const lineWords = `${lineLook.mark} ${sentence(LINE_WORDS[line].word)}${failures ? ` ×${failures}` : ''}`;
  const blocked =
    !!sizeProblem && sizeProblem.kind !== 'no-entry' && sizeProblem.kind !== 'no-stop';
  const sizeLine = size
    ? `${size.contracts}×${size.accounts} · ${dollarText(size.riskTotal)}`
    : blocked
      ? sizeProblem.title.toLowerCase()
      : 'no stop yet';
  // Per trade, per account: with copied accounts it says so.
  const perTrade =
    tradeRisk === null ? 'not set' : `${dollarText(tradeRisk)}${accounts > 1 ? '/acct' : ''}`;
  return (
    <View testID="indicators" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      <Tile
        testID="tile-plan"
        label={`HTF · ${mode}`}
        value={biasWord}
        color={biasLook.color}
        look={directional(bias) ? biasLook : undefined}
        words
        spoken={`HTF plan: ${bias ?? 'not set'}. ${mode}. ${why}`}
      />
      <Tile
        testID="tile-target"
        label={target2 !== null ? `Target · then ${priceText(target2)}` : 'Target'}
        value={target === null ? '—' : priceText(target)}
        spoken={`Target ${target === null ? 'not set' : priceText(target)}${target2 !== null ? `, then ${priceText(target2)}` : ''}${invalidation !== null ? `. Invalidation ${priceText(invalidation)}` : ''}.`}
      />
      <Tile
        testID="tile-location"
        label={lineWords}
        labelColor={lineLook.color}
        value={lineLabel}
        words
        lines={compact ? 1 : 2}
        spoken={`Location ${lineLabel}: ${LINE_WORDS[line].word}. ${LINE_WORDS[line].line} Self-reported.`}
      />
      {/* The planned size and its total across accounts are the value once the stop sets them. */}
      <Tile
        testID="tile-risk"
        label={size ? `Risk · ${perTrade}` : blocked ? 'Risk · blocked' : 'Risk / trade'}
        value={size ? sizeLine : perTrade}
        spoken={`Risk ${tradeRisk === null ? 'not set' : `${dollarText(tradeRisk)} per trade on each of ${accounts} account${accounts === 1 ? '' : 's'}`}. ${size ? `${size.contracts} contracts on each account, ${dollarText(size.riskTotal)} in all, planned.` : sizeLine}`}
      />
    </View>
  );
}, sameValues);

/** An amount left as a figure and a note: "$150", "unknown", "$10" planned. */
function figureOf(left: Left | null): { value: string; note: string | null } {
  if (!left) return { value: '—', note: null };
  if (left.amount === null) return { value: 'unknown', note: null };
  return { value: dollarText(Math.max(left.amount, 0)), note: left.planned ? 'planned' : null };
}

/** One figure of the thesis strip: a rounded number over its label, hairlines between them. */
function StripCell({
  value,
  label,
  first = false,
  narrow,
}: {
  value: string;
  label: string;
  first?: boolean;
  narrow: boolean;
}) {
  // "unknown" is a word, never a zero: it reads in words, smaller than a figure.
  const word = !/\d/.test(value);
  const size = word ? 15 : narrow ? 18 : 24;
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
        paddingHorizontal: 4,
        borderLeftWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderLeftColor: palette.separator,
      }}>
      <Text
        style={{
          ...(word ? fonts.bold : fonts.figureHeavy),
          fontSize: size,
          lineHeight: Math.round(size * 1.2),
          textAlign: 'center',
          color: palette.label,
        }}>
        {value}
      </Text>
      <Text style={{ ...type.footnote, fontSize: 12, lineHeight: 16, textAlign: 'center' }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The current thesis in one strip: attempts, what the thesis and the day have left, honestly. The
 * amounts are across every account; with copied accounts each says so.
 */
export const ThesisStrip = memo(function ThesisStrip({
  thesis,
  attemptsUsed,
  attemptsMax,
  thesisLeft,
  dailyLoss,
  dailyCap,
  accounts,
  sessionLoss,
  ended,
  regime,
}: {
  /** The thesis's name when it is not the plan's own (a later one, an exception), else null. */
  thesis: string | null;
  attemptsUsed: number;
  attemptsMax: number;
  thesisLeft: Left | null;
  /** The daily loss limit per account, or null when not set. */
  dailyLoss: number | null;
  /** The session's daily loss across accounts and whether the total cap sets it (`dailyLossCap`). */
  dailyCap: { amount: number; total: boolean } | null;
  accounts: number;
  sessionLoss: LossTotal;
  /** The session has ended: no attempt is open to it, so none is counted as if one were. */
  ended: boolean;
  /** The regime chip as set, or null: unassessed never blocks, so it is not shown. */
  regime: string | null;
}) {
  const copied = accounts > 1;
  const daily =
    dailyLoss === null || dailyCap === null
      ? 'no limit set'
      : `${lossText(sessionLoss)} of ${dollarText(dailyCap.amount)}${dailyCap.total ? ' (total cap)' : copied ? ` (${accounts} × ${dollarText(dailyLoss)})` : ''}`;
  const attempts = ended ? '' : `${attemptsUsed}/${attemptsMax} attempts · `;
  // The sentence VoiceOver reads; the strip shows the same figures as a scoreboard.
  const text = `${thesis ? `${thesis} · ` : ''}${attempts}thesis left ${leftText(thesisLeft)}${copied ? ` (${accounts} accts)` : ''} · loss ${daily}`;
  const narrow = useCompactCockpit();
  const left = figureOf(thesisLeft);
  const loss: { value: string; note: string | null } = sessionLoss.unknown
    ? { value: 'unknown', note: null }
    : { value: dollarText(sessionLoss.amount), note: sessionLoss.planned ? 'planned' : null };
  const cap =
    dailyLoss === null || dailyCap === null
      ? null
      : `${dollarText(dailyCap.amount)}${dailyCap.total ? ' total' : ''}`;
  const footnote = [
    regime ? `Regime ${regime}` : null,
    copied ? `Across ${accounts} accounts` : null,
    'Not broker-verified',
  ]
    .filter(Boolean)
    .join(' · ');
  const note = (
    <Text
      style={{
        ...type.footnote,
        fontSize: 12,
        lineHeight: 16,
        textAlign: 'center',
        paddingHorizontal: 8,
      }}>
      {footnote}
    </Text>
  );
  // On a compact cockpit the line sits right under the card, so the card keeps its height.
  return (
    <>
      <View
        testID="thesis-strip"
        accessible
        accessibilityLabel={`${text}. Regime ${regime ?? 'not set'}. ${NOT_VERIFIED_LINE}.`}
        style={{
          gap: narrow ? 2 : 6,
          paddingTop: narrow ? 6 : 12,
          paddingBottom: narrow ? 6 : 10,
          paddingHorizontal: 6,
          borderRadius: radius.tile,
          backgroundColor: palette.surface,
          ...depth.card,
        }}>
        {thesis && (
          <Text style={{ ...type.meta, textAlign: 'center', color: palette.label2 }}>{thesis}</Text>
        )}
        <View style={{ flexDirection: 'row' }}>
          {!ended && (
            <StripCell
              first
              value={`${attemptsUsed}/${attemptsMax}`}
              label="Attempts"
              narrow={narrow}
            />
          )}
          <StripCell
            first={ended}
            value={left.value}
            label={left.note ? `Thesis left · ${left.note}` : 'Thesis left'}
            narrow={narrow}
          />
          <StripCell
            value={loss.value}
            label={
              cap === null
                ? 'Loss · no limit set'
                : `Loss of ${cap}${loss.note ? ` · ${loss.note}` : ''}`
            }
            narrow={narrow}
          />
        </View>
        {!narrow && note}
      </View>
      {narrow && note}
    </>
  );
}, sameValues);

/**
 * The session's own caps as plain counts, under the thesis strip while the session runs: "Session:
 * entries 2 of 3 · losses in a row 1 of 2" (example). Beside the thesis's attempts, whichever is
 * stricter holds; no countdown styling.
 */
export const SessionCounts = memo(function SessionCounts({
  entries,
  entriesMax,
  lossRun,
  lossRunMax,
}: {
  entries: number;
  entriesMax: number;
  lossRun: number;
  lossRunMax: number;
}) {
  return (
    <Text testID="session-counts" style={{ ...type.caption, paddingHorizontal: 2 }}>
      {`Session: entries ${entries} of ${entriesMax} · losses in a row ${lossRun} of ${lossRunMax}`}
    </Text>
  );
}, sameValues);

/** A neutral on/off chip: "Setup confirmed". */
function Toggle({ title, on, onPress }: { title: string; on: boolean; onPress: () => void }) {
  const busy = useBusy();
  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityLabel={title}
      aria-checked={on}
      accessibilityState={{ checked: on, disabled: busy }}
      aria-disabled={busy}
      disabled={busy}
      onPress={onPress}
      style={[chipStyle(on), { minHeight: 48, paddingHorizontal: 16 }]}>
      {on && <Tick color={palette.label} small />}
      <Bold text={title} color={palette.label} size={15} />
    </PressableScale>
  );
}

/** A group label above a row of chips. */
function GroupLabel({ text }: { text: string }) {
  return <Text style={{ ...type.meta, paddingTop: 2 }}>{text}</Text>;
}

const ZONES: { id: ZoneState; title: string; label: string }[] = [
  { id: 'away', title: 'Away', label: 'Price away from my area' },
  { id: 'at', title: 'At area', label: 'Price at my area' },
  { id: 'left', title: 'Left', label: 'Price left my area' },
];

type SetupChip = SetupId | 'double-pierce-fast';

/** The location: where price is against the area. */
export const LocationControls = memo(function LocationControls({
  routineId,
  zone,
  write,
}: {
  routineId: string;
  zone: ZoneState | null;
  write: LiveWrite;
}) {
  return (
    <View testID="location-controls" style={{ gap: 6 }}>
      <GroupLabel text="Price vs my area" />
      <ChoiceRow
        label="Price versus my area"
        options={ZONES}
        value={zone}
        look={NEUTRAL}
        onChange={(z) => void write((s, at) => assess(s, routineId, { zone: z }, at))}
      />
    </View>
  );
});

/**
 * Mark baiting: one tap, no undo, so it sits on its own under the setup and entry, away from the
 * zone chips tapped most.
 */
export const MarkBaiting = memo(function MarkBaiting({
  routineId,
  where,
  write,
}: {
  routineId: string;
  where: string;
  write: LiveWrite;
}) {
  return (
    <View testID="mark-baiting" style={{ gap: 6, paddingTop: 10 }}>
      <GroupLabel text={`Line · ${where}`} />
      <OutlineButton
        title="Mark baiting"
        label={`Mark ${where} baiting for the rest of the session`}
        look={AMBER}
        onPress={() => void write((s, at) => markLine(s, routineId, where, 'baiting', null, at))}
      />
    </View>
  );
});

/**
 * The setup, read live in taps: the named setup and its chart, how a CISD was confirmed (a single
 * wick is shown and marked not enough), and confirmed. Once confirmed and complete it folds to the
 * one toggle that names it, so the entry and stop come up where the last tap was; untick it to
 * change.
 */
export const SetupControls = memo(function SetupControls({
  routineId,
  setup,
  fast,
  timeframe,
  cisd,
  confirmed,
  retakeSet,
  write,
}: {
  routineId: string;
  setup: SetupId | null;
  fast: boolean;
  timeframe: Timeframe | null;
  cisd: CisdHow | null;
  confirmed: boolean;
  retakeSet: boolean;
  write: LiveWrite;
}) {
  const chosen: SetupChip | null = setup === 'double-pierce' && fast ? 'double-pierce-fast' : setup;
  const options: { id: SetupChip; title: string; label: string }[] = [
    ...SETUPS.map((s) => ({
      id: s.id as SetupChip,
      title: `${s.letter} · ${s.id === 'pierce-push' ? 'Pierce' : s.id === 'sweep-retake' ? 'Sweep' : 'Double'}`,
      label: `Setup ${s.letter}: ${s.name}${s.id === 'sweep-retake' && !retakeSet ? ', retake rule not written yet' : ''}`,
    })),
    { id: 'double-pierce-fast', title: 'C · Fast', label: 'Setup C: fast break and reclaim' },
  ];
  const assessing = (change: Parameters<typeof assess>[2]) =>
    void write((s, at) => assess(s, routineId, change, at));
  const named = options.find((o) => o.id === chosen);
  // Folded only when complete: an incomplete confirmation keeps its chips open to put right.
  const complete =
    cisd !== 'single-wick' && (setup !== 'sweep-retake' || retakeSet) && !!named && !!timeframe;
  if (confirmed && complete)
    return (
      <View testID="setup-controls" style={{ gap: 6 }}>
        <GroupLabel text="Setup" />
        <Toggle
          title={`Setup confirmed · ${named!.title} · ${timeframe}`}
          on
          onPress={() => assessing({ confirmed: false })}
        />
      </View>
    );
  return (
    <View testID="setup-controls" style={{ gap: 6 }}>
      <GroupLabel text="Setup · 5m / 15m" />
      <ChoiceRow
        label="Named setup"
        options={options}
        value={chosen}
        look={NEUTRAL}
        onChange={(id) =>
          assessing(
            id === 'double-pierce-fast'
              ? { setup: 'double-pierce', fast: true }
              : { setup: id, fast: undefined },
          )
        }
      />
      <ChoiceRow
        label="Chart"
        options={[
          { id: '5m' as Timeframe, title: '5m', label: '5 minute chart' },
          { id: '15m' as Timeframe, title: '15m', label: '15 minute chart' },
        ]}
        value={timeframe}
        look={NEUTRAL}
        onChange={(t) => assessing({ timeframe: t })}
      />
      {setup === 'sweep-retake' && !retakeSet && (
        <Text style={{ ...type.caption, color: market.amber }}>
          Setup B cannot complete until its retake rule is written in My strategy.
        </Text>
      )}
      {!!setup && !!timeframe && (
        <>
          <GroupLabel text="CISD · only if part of the setup" />
          <ChoiceRow
            label="How the CISD was confirmed"
            options={CISD_CHOICES.map((c) => ({
              id: c.id,
              title: c.enough ? c.label : 'Single wick ✕',
              label: c.label,
            }))}
            value={cisd}
            look={NEUTRAL}
            onChange={(c) => assessing({ cisd: c === cisd ? null : c })}
          />
          {cisd === 'single-wick' && (
            <Text style={{ ...type.caption, color: market.amber }}>{CISD_RULE}</Text>
          )}
          <Toggle
            title="Setup confirmed"
            on={confirmed}
            onPress={() => assessing({ confirmed: !confirmed })}
          />
        </>
      )}
    </View>
  );
});

/**
 * Once the setup is confirmed: the entry and the stop (one sheet), and I ENTERED, enabled only at
 * SETUP CHECKS COMPLETE. Shown right under the confirmed setup, where the last tap was.
 */
export const EntryActions = memo(function EntryActions({
  routineId,
  entry,
  stop,
  complete,
  write,
  openRisk,
}: {
  routineId: string;
  entry: number | null;
  stop: number | null;
  complete: boolean;
  write: LiveWrite;
  openRisk: () => void;
}) {
  const enter = async () => {
    let refused: unknown = null;
    const ok = await write((s, at) => {
      try {
        return enterAttempt(s, routineId, at);
      } catch (e) {
        refused = e;
        throw e;
      }
    });
    if (ok || !refused) return;
    // Refused (the status changed under the tap): kept for the review, then its reason again.
    await write((s, at) => refuseEntry(s, routineId, at));
    await write(() => {
      throw refused;
    });
  };
  return (
    <View testID="entry-actions" style={{ gap: 8 }}>
      {complete && (
        <CockpitButton
          testID="i-entered"
          title="I entered"
          label="I entered in my broker"
          look={NEUTRAL}
          onPress={() => void enter()}
        />
      )}
      <OutlineButton
        title={
          entry !== null && stop !== null
            ? `Entry ${priceText(entry)} · stop ${priceText(stop)}`
            : 'Entry & stop'
        }
        label="Enter the entry and the structural stop"
        look={NEUTRAL}
        onPress={openRisk}
      />
    </View>
  );
});

const REGIMES: { id: ObservedKind; title: string; label: string }[] = [
  { id: 'range', title: 'Range', label: 'Range / chop' },
  { id: 'directional', title: 'Directional', label: 'Directional delivery' },
  { id: 'candidate', title: 'Candidate', label: 'Expansion candidate' },
  { id: 'confirmed', title: 'Confirmed', label: 'Confirmed expansion' },
];

/** The observed regime: one optional chip, manual and timestamped. Only Range blocks. */
export const RegimeControls = memo(function RegimeControls({
  routineId,
  kind,
  write,
}: {
  routineId: string;
  kind: ObservedKind | null;
  write: LiveWrite;
}) {
  return (
    <View testID="regime-controls" style={{ gap: 6 }}>
      <GroupLabel text="Regime · optional · only Range blocks" />
      <ChoiceRow
        label="Observed regime"
        options={REGIMES}
        value={kind}
        look={NEUTRAL}
        onChange={(k) => void write((s, at) => setRegime(s, routineId, k, at))}
      />
    </View>
  );
});

/** How the open trade ended: one tap each. A partial exit is never a new attempt. */
export const OutcomeActions = memo(function OutcomeActions({
  routineId,
  attemptId,
  write,
}: {
  routineId: string;
  attemptId: string;
  write: LiveWrite;
}) {
  const exit = (report: Parameters<typeof recordExit>[3]) =>
    void write((s, at) => recordExit(s, routineId, attemptId, report, at));
  return (
    <View testID="outcome-actions" style={{ gap: 8 }}>
      <GroupLabel text="How it ended" />
      <OutlineButton
        title="Objective reached"
        look={GEX_LOOK}
        onPress={() => exit({ kind: 'objective', result: 'gain' })}
      />
      <StopButton title="Stopped out" onPress={() => exit({ kind: 'stopped', result: 'loss' })} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <View style={{ flexGrow: 1, flexBasis: 130 }}>
          <OutlineButton
            title="Flat · no loss"
            label="Closed flat, breakeven or better"
            look={NEUTRAL}
            onPress={() => exit({ kind: 'flat', result: 'breakeven' })}
          />
        </View>
        <View style={{ flexGrow: 1, flexBasis: 130 }}>
          <OutlineButton
            title="Flat · small loss"
            label="Closed flat with a small loss"
            look={NEUTRAL}
            onPress={() => exit({ kind: 'flat', result: 'loss' })}
          />
        </View>
      </View>
      <StopButton
        title="Structural invalidation"
        label="Structural invalidation: retire this thesis"
        onPress={() => exit({ kind: 'invalidated', result: 'loss' })}
      />
      <View style={[styles.row, { columnGap: 16 }]}>
        <LinkButton
          title="Partial exit"
          label="Record a partial exit: the same attempt"
          onPress={() => void write((s, at) => recordPartial(s, routineId, attemptId, at))}
        />
        <LinkButton
          title="Closed in broker earlier"
          label="Closed in my broker earlier, not recorded here"
          onPress={() => exit({ kind: 'reconciled' })}
        />
      </View>
    </View>
  );
});

/** Reports a closed trade's loss across every account: once, then it stays. */
export function LossReport({
  routineId,
  attempt,
  required,
  write,
}: {
  routineId: string;
  attempt: Attempt;
  required: boolean;
  write: LiveWrite;
}) {
  const [text, setText] = useState('');
  const loss = parsePrice(text);
  const estimate = attempt.plannedRisk;
  return (
    <View testID="loss-report" style={{ gap: 6 }}>
      <Text style={type.caption}>
        {required
          ? `${attempt.stop === null ? 'This trade had no stop' : 'Its risk could not be counted'}: its loss is unknown, and unknown is never counted as zero.`
          : `Counted at its planned risk${estimate !== null ? ` of ${dollarText(estimate)}` : ''} until you report the loss.`}
      </Text>
      <Field
        label="Loss across all accounts · $"
        value={text}
        onChange={setText}
        decimal
        tint={palette.label}
      />
      <Button
        secondary
        title="Report loss"
        disabled={loss === null}
        onPress={() =>
          void write((s, at) => reportLoss(s, routineId, attempt.id, loss!, at)).then(
            (ok) => ok && setText(''),
          )
        }
      />
    </View>
  );
}

/** After a failed attempt and its cooldown: still valid, or retired. Answered once. */
export const ResetActions = memo(function ResetActions({
  routineId,
  thesisId,
  write,
}: {
  routineId: string;
  thesisId: string;
  write: LiveWrite;
}) {
  return (
    <View testID="reset-actions" style={{ gap: 8 }}>
      <Text style={type.item}>Is the thesis still valid, its structure still relevant?</Text>
      <Text style={type.caption}>
        Yes keeps one more attempt open, and it still needs a new qualified setup. No is final.
      </Text>
      <OutlineButton
        title="Still valid"
        look={NEUTRAL}
        onPress={() => void write((s, at) => answerReset(s, routineId, thesisId, true, at))}
      />
      <StopButton
        title="Retire it"
        label="No longer valid: retire this thesis"
        onPress={() => void write((s, at) => answerReset(s, routineId, thesisId, false, at))}
      />
    </View>
  );
});

/** The cooldown: an end time and what to do now, never a countdown to the next trade. */
export function CooldownPanel({ line, loss }: { line: string; loss: boolean }) {
  return (
    <View
      testID="cooldown"
      style={{
        gap: 6,
        padding: 14,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: market.amberEdge,
        backgroundColor: palette.surface,
      }}>
      <Bold text={line} color={market.amber} size={16} />
      <Text style={type.body}>Stand up. Drink some water. Look away from the charts.</Text>
      {loss && (
        <Text style={type.body}>
          In your broker: check every account is flat and cancel working orders. Life OS cannot see
          your broker.
        </Text>
      )}
      <Text style={type.caption}>
        It ends at that time and cannot be ended early. Nothing qualifies while it runs.
      </Text>
    </View>
  );
}

/**
 * The session ended: why and until when (as the band says, never cut here), and the review.
 * Nothing here restarts it.
 */
export function StopPanel({
  line,
  review,
}: {
  line: string;
  review: { title: string; open: () => void } | null;
}) {
  return (
    <View testID="session-stopped" style={{ gap: 8 }}>
      <Text style={type.body}>{line}</Text>
      <Text style={type.caption}>
        A no-trade day is fine. A new thesis, a new bias, reloading or a new record does not reopen
        it.
      </Text>
      {review && <CockpitButton title={review.title} look={NEUTRAL} onPress={review.open} />}
    </View>
  );
}

/** The entry and the structural stop, with the size they allow: contracts are never typed up. */
export function RiskSheet({
  visible,
  close,
  routineId,
  side,
  target,
  invalidation,
  entry: savedEntry,
  stop: savedStop,
  contracts: savedContracts,
  limits,
  thesisLeft,
  dailyLeft,
  write,
}: {
  visible: boolean;
  close: () => void;
  routineId: string;
  side: 'long' | 'short';
  target: number;
  /** The thesis's structural invalidation, shown beside the stop. */
  invalidation: number;
  entry: number | null;
  stop: number | null;
  contracts: number | null;
  limits: LiveLimits | null;
  thesisLeft: Left | null;
  dailyLeft: Left | null;
  write: LiveWrite;
}) {
  if (!visible) return null;
  return (
    <RiskForm
      {...{ close, routineId, side, target, invalidation, limits, thesisLeft, dailyLeft, write }}
      entry={savedEntry}
      stop={savedStop}
      contracts={savedContracts}
    />
  );
}

function RiskForm({
  close,
  routineId,
  side,
  target,
  invalidation,
  entry: savedEntry,
  stop: savedStop,
  contracts: savedContracts,
  limits,
  thesisLeft,
  dailyLeft,
  write,
}: Omit<Parameters<typeof RiskSheet>[0], 'visible'>) {
  const shown = (n: number | null) => (n === null ? '' : String(n));
  const [entry, setEntry] = useState(shown(savedEntry));
  const [stop, setStop] = useState(shown(savedStop));
  const [fewer, setFewer] = useState(shown(savedContracts));
  const e = parsePrice(entry);
  const st = parsePrice(stop);
  const c = fewer.trim() ? parseContracts(fewer) : null;
  const sized =
    limits && thesisLeft && dailyLeft
      ? sizeTrade({ side, entry: e, stop: st, target, contracts: c, limits, thesisLeft, dailyLeft })
      : null;
  const save = () =>
    void write((s, at) =>
      assess(s, routineId, { entry: e, stop: st, contracts: fewer.trim() ? c : null }, at),
    ).then((ok) => ok && close());
  return (
    <Sheet
      title="Entry & stop"
      visible
      close={close}
      footer={
        <CockpitButton
          title="Save"
          look={NEUTRAL}
          disabled={e === null || st === null}
          onPress={save}
        />
      }>
      <Text style={type.caption}>
        {`${side === 'long' ? 'Long' : 'Short'} toward ${priceText(target)}, invalidation ${priceText(invalidation)}. Your fixed risk sets the size: the structural stop decides the contracts.`}
      </Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Field label="Entry" value={entry} onChange={setEntry} decimal tint={palette.label} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Stop" value={stop} onChange={setStop} decimal tint={palette.label} />
        </View>
      </View>
      <View
        testID="risk-size"
        accessible
        accessibilityLiveRegion="polite"
        aria-live="polite"
        style={{
          gap: 2,
          padding: 12,
          borderRadius: radius.control,
          borderWidth: 1,
          borderColor: sized?.problem ? palette.danger : palette.edge,
          backgroundColor: palette.canvas,
        }}>
        {sized?.size ? (
          <>
            <Bold
              text={`${sized.size.contracts} contract${sized.size.contracts === 1 ? '' : 's'} × ${sized.size.accounts} account${sized.size.accounts === 1 ? '' : 's'}`}
              color={palette.label}
              size={16}
            />
            <Text style={type.caption}>
              {`${dollarText(sized.size.riskPerAccount)} per account · ${dollarText(sized.size.riskTotal)} in all · ${sized.size.costsIncluded ? 'costs included' : 'costs not included'}`}
            </Text>
            <Text style={type.caption}>
              {`Thesis left ${leftText(thesisLeft)} · day left ${leftText(dailyLeft)} · planned, not broker-verified`}
            </Text>
          </>
        ) : sized?.problem ? (
          <>
            <Bold text={sized.problem.title} color={palette.danger} size={15} />
            <Text style={type.caption}>{sized.problem.text}</Text>
          </>
        ) : (
          <Text style={type.caption}>Set your limits first.</Text>
        )}
      </View>
      <Field
        label="Fewer contracts · optional"
        value={fewer}
        onChange={setFewer}
        numeric
        hint="Only lowers the size; it never raises it."
        tint={palette.label}
      />
    </Sheet>
  );
}

/**
 * A new thesis: a different area, one line on what changed, its target and invalidation. Against
 * the bias only behind its exception, with a written justification. What holds it is said under
 * Start, from the same rule that refuses it.
 */
export function NewThesisSheet({
  visible,
  close,
  ctx,
  side,
  target,
  write,
}: {
  visible: boolean;
  close: () => void;
  ctx: LiveContext;
  side: 'long' | 'short';
  target: number | null;
  write: LiveWrite;
}) {
  if (!visible) return null;
  return <NewThesisForm close={close} ctx={ctx} side={side} target={target} write={write} />;
}

function NewThesisForm({
  close,
  ctx,
  side,
  target: planTarget,
  write,
}: Omit<Parameters<typeof NewThesisSheet>[0], 'visible'>) {
  const [where, setWhere] = useState('');
  const [changed, setChanged] = useState('');
  const [target, setTarget] = useState(planTarget === null ? '' : String(planTarget));
  const [invalidation, setInvalidation] = useState('');
  const [exception, setException] = useState<string | null>(null);
  const counter = exception !== null;
  const draft: ThesisDraft = {
    where,
    changed,
    target: parsePrice(target),
    invalidation: parsePrice(invalidation),
    ...(counter && { direction: side === 'long' ? 'short' : 'long', exception }),
  };
  const problem = newThesisProblem(ctx, draft);
  return (
    <Sheet
      title="New thesis"
      visible
      close={close}
      footer={
        <CockpitButton
          title="Start this thesis"
          look={NEUTRAL}
          disabled={!!problem}
          needs={problem}
          onPress={() =>
            void write((s, at) => newThesis(s, ctx.routineId, draft, at)).then(
              (ok) => ok && close(),
            )
          }
        />
      }>
      <Text style={type.caption}>
        A new idea needs a different area and a real change. Another wick at the same line, a new
        name or a nudged price is the same idea. Self-reported: Life OS has no market data.
      </Text>
      <Field
        label="Where · a different area"
        value={where}
        onChange={setWhere}
        maxLength={WHERE_MAX}
        placeholder="My area"
      />
      <Field label="What changed · one line" value={changed} onChange={setChanged} wrap name />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Field label="Target" value={target} onChange={setTarget} decimal />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Invalidation" value={invalidation} onChange={setInvalidation} decimal />
        </View>
      </View>
      <Toggle
        title="Exception · against the bias"
        on={counter}
        onPress={() => setException(counter ? null : '')}
      />
      {counter && (
        <Field
          label="Structural justification · e.g. FVG + GEX"
          value={exception}
          onChange={setException}
          wrap
          name
          maxLength={EXCEPTION_MAX}
          hint="Counted as an EXCEPTION in the review."
        />
      )}
    </Sheet>
  );
}

/** Ending the session by hand: finished, a hard stop, or the HTF thesis invalidated. */
export function EndSheet({
  visible,
  close,
  routineId,
  write,
}: {
  visible: boolean;
  close: () => void;
  routineId: string;
  write: LiveWrite;
}) {
  const end = (fn: (s: State, at: string) => State) => void write(fn).then((ok) => ok && close());
  return (
    <Sheet title="End the session" visible={visible} close={close}>
      <OutlineButton
        title="Finished for today"
        look={NEUTRAL}
        onPress={() => end((s, at) => endSession(s, routineId, 'finished', at))}
      />
      <StopButton
        title="Hard stop · a limit was hit"
        label="Hard stop: a limit was hit. No new trading until the next 9:30 AM window."
        onPress={() => end((s, at) => endSession(s, routineId, 'hard-stop', at))}
      />
      <StopButton
        title="HTF thesis invalidated"
        label="HTF thesis invalidated. No new trading until the next 9:30 AM window."
        onPress={() => end((s, at) => invalidateHtf(s, routineId, at))}
      />
      <Text style={type.caption}>
        A hard stop or an invalidated HTF thesis holds until the next 9:30 AM window. Flatten,
        cancel and check every account is flat in your platform.
      </Text>
    </Sheet>
  );
}

/** The line invalidated for the session, with a short reason. There is no undo. */
export function LineSheet({
  visible,
  close,
  routineId,
  where,
  write,
}: {
  visible: boolean;
  close: () => void;
  routineId: string;
  where: string;
  write: LiveWrite;
}) {
  const [reason, setReason] = useState('');
  return (
    <Sheet title={`${where} invalidated`} visible={visible} close={close}>
      <Text style={type.caption}>
        A separate structural condition invalidated the level. It stays invalidated for the rest of
        the session. A failed entry alone is not this: it is a failed attempt.
      </Text>
      <Field label="What invalidated it · a few words" value={reason} onChange={setReason} name />
      <CockpitButton
        title="Mark invalidated"
        look={NEUTRAL}
        disabled={!reason.trim()}
        onPress={() =>
          void write((s, at) => markLine(s, routineId, where, 'invalidated', reason, at)).then(
            (ok) => ok && close(),
          )
        }
      />
    </Sheet>
  );
}

/**
 * Log an entry I took: a trade the cockpit did not open, recorded as it was so none disappears.
 * Without a stop its exposure is unknown, never zero.
 */
export function TakenSheet({
  visible,
  close,
  routineId,
  bias,
  write,
}: {
  visible: boolean;
  close: () => void;
  routineId: string;
  bias: DailyBias | null;
  write: LiveWrite;
}) {
  if (!visible) return null;
  return <TakenForm close={close} routineId={routineId} bias={bias} write={write} />;
}

function TakenForm({
  close,
  routineId,
  bias,
  write,
}: Omit<Parameters<typeof TakenSheet>[0], 'visible'>) {
  const [side, setSide] = useState<'long' | 'short'>(bias === 'bearish' ? 'short' : 'long');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [contracts, setContracts] = useState('');
  const e = parsePrice(entry);
  const c = parseContracts(contracts);
  return (
    <Sheet title="Log an entry I took" visible close={close}>
      <Text style={type.caption}>
        Recorded as taken now, with the status that stands now. It counts toward the session, as an
        attempt on the thesis you are working when it is on its side, and shows in the review.
      </Text>
      <ChoiceRow
        label="Side"
        options={[
          { id: 'long' as const, title: 'Long' },
          { id: 'short' as const, title: 'Short' },
        ]}
        value={side}
        look={NEUTRAL}
        onChange={setSide}
      />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Field label="Entry" value={entry} onChange={setEntry} decimal />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Stop · if any" value={stop} onChange={setStop} decimal />
        </View>
      </View>
      <Field label="Contracts per account" value={contracts} onChange={setContracts} numeric />
      {!stop.trim() && (
        <Text style={{ ...type.caption, color: market.amber }}>
          No stop: the exposure is unknown until you report the loss.
        </Text>
      )}
      <CockpitButton
        title="Log this entry"
        look={NEUTRAL}
        disabled={e === null || c === null}
        onPress={() =>
          void write((s, at) =>
            logTakenAttempt(
              s,
              routineId,
              { side, entry: e!, stop: parsePrice(stop), contracts: c! },
              at,
            ),
          ).then((ok) => ok && close())
        }
      />
    </Sheet>
  );
}

/** I FEEL RUSHED: always on screen, calm, one tap. A cooldown starts at once. */
export const RushedButton = memo(function RushedButton({
  routineId,
  write,
}: {
  routineId: string;
  write: LiveWrite;
}) {
  return (
    <Pressable
      testID="i-feel-rushed"
      accessibilityRole="button"
      accessibilityLabel="I feel rushed: start a cooldown now"
      onPress={() => void write((s, at) => feelRushed(s, routineId, at))}
      style={({ pressed }) => ({
        minHeight: 46,
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderRadius: radius.capsule,
        borderWidth: 2,
        borderColor: market.amberEdge,
        backgroundColor: pressed ? market.amberTint : palette.surface,
        alignItems: 'center',
        justifyContent: 'center',
      })}>
      <Text style={{ ...type.status, fontSize: 16, lineHeight: 20, color: market.amber }}>
        I feel rushed
      </Text>
    </Pressable>
  );
});

/** A link or an action under the cockpit. */
export type CockpitLink = {
  title: string;
  label?: string;
  onPress: () => void;
  /** A symbol for an action row. */
  glyph?: GlyphName;
  /** Opens a sheet or a page (a chevron), rather than acting at once. */
  opens?: boolean;
};

/**
 * The quiet links under the cockpit, grouped: the reference pages as one row of small capsules,
 * and the session's own actions as one grouped list, each named in full. Nothing here is the
 * screen's primary.
 */
export function CockpitLinks({ pages, actions }: { pages: CockpitLink[]; actions: CockpitLink[] }) {
  return (
    <View testID="cockpit-links" style={{ gap: 14 }}>
      {actions.length > 0 && (
        <Group title="Session" icons>
          {actions.map((l) => (
            <Row
              key={l.title}
              title={l.title}
              label={l.label}
              onPress={l.onPress}
              icon={l.glyph}
              chevron={!!l.opens}
            />
          ))}
        </Group>
      )}
      <View style={[styles.row, { gap: 8 }]}>
        {pages.map((l) => (
          <LinkButton
            key={l.title}
            tone="pill"
            title={l.title}
            label={l.label}
            onPress={l.onPress}
          />
        ))}
      </View>
    </View>
  );
}

/** Opens My Trading Strategy. */
export const openStrategy = () => router.push('/strategy');

/**
 * My Trading Strategy from the page header, beside Back: a book, small enough to leave the title
 * and Back whole on the narrowest phone with larger text.
 */
export function StrategyLink() {
  return (
    <PressableScale
      testID="strategy-link"
      accessibilityRole="button"
      accessibilityLabel="Open My Trading Strategy"
      onPress={openStrategy}
      style={{
        width: 44,
        height: 44,
        borderRadius: radius.control,
        borderWidth: 1,
        borderColor: palette.separator,
        backgroundColor: palette.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <SymbolView
        name="book.closed"
        size={18}
        tintColor={palette.label}
        fallback={
          <Text style={{ ...fonts.figure, fontSize: 18, color: palette.label }}>{'▤'}</Text>
        }
      />
    </PressableScale>
  );
}

/** The notes under the status that are not already on screen: a warning line, the chart line. */
export const StatusNotes = memo(function StatusNotes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <View testID="status-notes" style={{ gap: 2 }}>
      {notes.map((n) => (
        <Text
          key={n}
          style={{
            ...type.caption,
            color: n === CHART_LINE || n.startsWith('EXCEPTION') ? market.amber : palette.label2,
          }}>
          {n}
        </Text>
      ))}
    </View>
  );
}, sameValues);
