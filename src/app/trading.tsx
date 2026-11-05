import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { RuleBook, dateObject, displayDate, localDate } from '../domain/model';
import {
  TradingSession,
  candleReview,
  enableTrading,
  nextDayStudyOnly,
  onTradingSchedule,
  sideOf,
  tradingBook,
} from '../domain/trading';
import { cooldownLine, retireThesis, stopLine, unknownLossAttempt } from '../domain/trading-live';
import {
  FINAL_STATUSES,
  dailyLossCap,
  failedAttempt,
  whereText,
} from '../domain/trading-live-model';
import { OWN_REPORT_LINE } from '../domain/trading-rules';
import { regimeStamp } from '../domain/trading-status';
import { retakeRuleSet } from '../domain/trading-strategy';
import { useApp } from '../state/app-state';
import { announce, useAnnouncement } from '../ui/announce';
import { BiasStrip } from '../ui/bias-strip';
import {
  CooldownPanel,
  EndSheet,
  EntryActions,
  Indicators,
  LineSheet,
  LocationControls,
  LossReport,
  MarkBaiting,
  CockpitLink,
  CockpitLinks,
  NEUTRAL,
  NewThesisSheet,
  OutcomeActions,
  RegimeControls,
  ResetActions,
  RiskSheet,
  RushedButton,
  SessionCounts,
  SetupControls,
  StatusBand,
  StatusNotes,
  StatusReason,
  StopPanel,
  StrategyLink,
  TakenSheet,
  ThesisStrip,
  openStrategy,
  useCompactCockpit,
} from '../ui/cockpit';
import { ConfirmPlanButton, Preparation } from '../ui/cockpit-prep';
import { Button, LinkButton, Page, PageFooter, Reveal, styles } from '../ui/components';
import { CockpitButton, OutlineButton } from '../ui/trading-parts';
import { TradingLimitsSheet } from '../ui/trading-limits';
import { TradingProgress } from '../ui/trading-progress';
import { ReviewResult, TradingReviewSheet } from '../ui/trading-review';
import { ThesisCardView } from '../ui/trading-thesis';
import { useLiveStatus, useLiveWrite } from '../ui/use-live';
import { useNow, useTradingSession } from '../ui/use-trading-session';
import { fonts, palette, type } from '../ui/theme';

/** Shown, and spoken, when the candle's session cannot be read. */
const LOAD_FAILED_LINE =
  "This device could not read the candle's trading session, so it is not shown as new and nothing can be entered. The review still works.";

/** Statuses after which the thesis is retired: a new one needs another area. */
const RETIRED = ['THESIS_EXHAUSTED', 'THESIS_COMPLETED', 'THESIS_INVALIDATED', 'NO_THESIS'];

/** Statuses that hold the setup controls: something else is answered first. */
const HOLDS = ['LOAD_FAILED', 'UNKNOWN_EXPOSURE', 'RESET_ANSWER', 'LINE_BLOCKED', 'PLAN_RECONFIRM'];

/**
 * Trading: PROCESS > P&L. Today is the cockpit: Preparation before the session, then one live
 * screen under one status. An earlier day (`?date=`) is only reviewed. Everything is
 * self-reported: nothing here sees or blocks a broker account, and no money result is asked for
 * or rewarded.
 */
export default function TradingScreen() {
  const { state } = useApp();
  const params = useLocalSearchParams<{ date?: string }>();
  // Read the clock each minute, so a page left open past midnight acts on the new day.
  const today = localDate(new Date(useNow(Number.POSITIVE_INFINITY, 60_000)));
  let date = today;
  try {
    if (params.date && params.date <= today) {
      dateObject(params.date);
      date = params.date;
    }
  } catch {}
  const book = tradingBook(state);
  if (!book) return <Setup />;
  if (date !== today) return <PastDay key={date} date={date} today={today} book={book} />;
  return <CockpitScreen today={today} book={book} />;
}

function Setup() {
  const { state, change } = useApp();
  const candidates = state.ruleBooks.filter((b) =>
    state.programs.some((p) => p.routines.some((r) => r.id === b.routineId)),
  );
  return (
    <Page title="Trading" back>
      <View style={[styles.card, { gap: 12 }]}>
        <Text style={{ ...type.callout, color: palette.done }}>Process &gt; P&amp;L</Text>
        <Text style={styles.body}>
          Trading discipline turns a rule review into a daily process: preparation before the
          session, one live status during it, and eight PASS or FAIL items after it.
        </Text>
        {candidates.length ? (
          candidates.map((b) => (
            <Button
              key={b.id}
              title="Set up trading discipline"
              label={`Set up trading discipline for ${b.title}`}
              onPress={() =>
                void change((s) => enableTrading(s, b.routineId, new Date().toISOString()))
              }
            />
          ))
        ) : (
          <Text style={styles.muted}>
            Add a Rule review objective with your trading rules in Programs first, or import your
            private setup in Settings.
          </Text>
        )}
        <Text style={type.caption}>
          Your rulebook and earlier reviews are kept exactly as they are.
        </Text>
      </View>
    </Page>
  );
}

type Open = 'limits' | 'risk' | 'thesis' | 'end' | 'line' | 'taken' | null;

/** The candle's cockpit: Preparation, then the live screen, under one status. */
function CockpitScreen({ today, book }: { today: string; book: RuleBook }) {
  const { state } = useApp();
  const { ctx, status } = useLiveStatus(book);
  const write = useLiveWrite();
  const reviewed = ctx.reviewed ? candleReview(state, book.routineId, ctx.candle) : undefined;
  const [open, setOpen] = useState<Open>(null);
  const [reviewOf, setReviewOf] = useState<string | null>(null);
  const f = status.facts;
  const s = ctx.session;
  const routineId = book.routineId;
  const code = status.code;
  useAnnouncement(ctx.unreadable ? LOAD_FAILED_LINE : null);
  // A new status is said (iOS reads no live region), never the one the screen opens on. A new
  // title within one code (one risk problem replacing another) is a new status too.
  const said = useRef(status.title);
  useEffect(() => {
    if (said.current !== status.title) announce(`${status.title}. Next: ${status.next}`);
    said.current = status.title;
  }, [status.title, status.next]);
  const close = () => setOpen(null);
  const thesis = f.thesis;
  const active = !!thesis && !RETIRED.includes(code) && !FINAL_STATUSES.includes(f.thesisStatus!);
  const where = whereText(thesis?.where ?? s.plan?.where ?? '');
  const a = f.assessment;
  const stop = f.stop;
  // A candle is reviewed on its own date, once that date has come.
  const review =
    ctx.candle <= today
      ? {
          title: ctx.reviewed
            ? 'Correct the review'
            : ctx.candle === today
              ? 'Review today'
              : `Review ${displayDate(ctx.candle)}`,
          open: () => setReviewOf(ctx.candle),
        }
      : null;
  const attempts = s.attempts ?? [];
  // A loss unknown must be reported, on this candle or an earlier one; a failed attempt's planned
  // loss may be.
  const unknownLoss = unknownLossAttempt(ctx)?.attempt;
  const plannedLoss = [...attempts]
    .reverse()
    .find((x) => x.exit && failedAttempt(x) && x.exit.loss === undefined && x.plannedRisk);
  const controls = active && !f.open && !stop && !f.cooldown && !HOLDS.includes(code);
  const retire = () => void write((st, at) => retireThesis(st, routineId, thesis!.id, at));
  // The reference pages; before the start Preparation links Your limits beside its limits.
  const pages: CockpitLink[] = [
    { title: 'My strategy', label: 'Open My Trading Strategy', onPress: openStrategy },
    {
      title: 'Rules & GEX',
      label: 'Open Rules & GEX: the lock times and the rules',
      onPress: () => router.push('/bias-board'),
    },
    ...(f.started
      ? [{ title: 'Your limits', label: 'Edit your limits', onPress: () => setOpen('limits') }]
      : []),
  ];
  const actions: CockpitLink[] = [
    ...(review && !stop && !ctx.reviewed
      ? [{ title: review.title, onPress: review.open, glyph: 'check' as const, opens: true }]
      : []),
    ...(f.open
      ? []
      : [
          {
            title: 'Log an entry I took',
            onPress: () => setOpen('taken'),
            glyph: 'pencil' as const,
            opens: true,
          },
        ]),
    ...(f.started && active && !f.open && code !== 'LINE_BLOCKED'
      ? [
          { title: 'Retire this thesis', onPress: retire, glyph: 'close' as const },
          {
            title: 'Line invalidated…',
            label: `Mark ${where} invalidated, with a reason`,
            onPress: () => setOpen('line'),
            glyph: 'block' as const,
            opens: true,
          },
        ]
      : []),
    ...(f.started && !stop && !f.open
      ? [
          {
            title: 'End session…',
            onPress: () => setOpen('end'),
            glyph: 'flag' as const,
            opens: true,
          },
        ]
      : []),
  ];
  const compact = useCompactCockpit();
  // On a compact cockpit the band's why sits under the figures, unless the screen says it in full
  // already (a stop's line, the exhausted wording): then only its basis does.
  const why =
    (!f.open && stop && stopLine(stop) === status.reason) || code === 'THESIS_EXHAUSTED'
      ? null
      : status.reason;
  const notes = status.practice
    ? [
        `Practice only: ${f.practiceWhy.join(' ')}`,
        ...status.notes.filter((n) => !f.practiceWhy.includes(n)),
      ]
    : status.notes;
  return (
    <>
      <Page
        title="Trading"
        back
        compact
        keyboardInsets
        // The start, a new thesis and the end each open at the top, with the four tiles in view.
        scrollKey={`${f.started ? 'live' : 'prep'}:${thesis?.id ?? ''}:${stop ? 'stopped' : ''}`}
        accessory={<StrategyLink />}
        top={
          f.started ? undefined : (
            <Text style={styles.label}>{`${displayDate(ctx.candle)} candle`}</Text>
          )
        }
        header={
          <StatusBand
            title={status.title}
            reason={status.reason}
            next={status.next}
            tone={status.tone}
            basis={status.basis}
            practice={status.practice}
            event={status.event}
            compact={compact}
          />
        }
        footer={
          <PageFooter>
            <RushedButton routineId={routineId} write={write} />
          </PageFooter>
        }>
        {compact && !f.started && <StatusReason reason={why} basis={status.basis} />}
        {ctx.unreadable && (
          <Text accessibilityRole="alert" style={styles.alert}>
            {LOAD_FAILED_LINE}
          </Text>
        )}
        {f.started && (
          // On a compact cockpit the figures hug the tiles, so both stay on the first screen.
          <View style={{ gap: compact ? 6 : 16 }}>
            <Indicators
              bias={f.bias}
              conditional={!!s.plan?.conditional && thesis?.origin === 'plan'}
              where={where}
              why={s.plan?.why ?? ''}
              target={thesis?.target ?? s.plan?.target ?? null}
              target2={thesis?.origin === 'plan' ? (s.plan?.target2 ?? null) : null}
              invalidation={thesis?.invalidation ?? s.plan?.invalidation ?? null}
              lineLabel={f.line?.label ?? where}
              line={f.line?.status ?? 'normal'}
              failures={f.line?.failures ?? 0}
              tradeRisk={f.limits?.tradeRisk ?? null}
              accounts={f.limits?.accounts ?? 1}
              size={f.size}
              sizeProblem={f.sizeProblem}
            />
            <ThesisStrip
              thesis={
                // The plan's thesis needs no name; a later one, or an exception, is named.
                thesis && (thesis.origin !== 'plan' || thesis.exception)
                  ? `Thesis ${thesis.id.slice(1)}${thesis.exception ? ' · EXCEPTION' : ''}`
                  : null
              }
              attemptsUsed={f.attemptsUsed}
              attemptsMax={f.attemptsMax}
              thesisLeft={f.thesisLeft}
              dailyLoss={f.limits?.dailyLoss ?? null}
              dailyCap={f.limits ? dailyLossCap(f.limits) : null}
              accounts={f.limits?.accounts ?? 1}
              sessionLoss={f.sessionLoss}
              ended={!!stop}
              regime={f.regime ? `${f.regime.kind} · ${regimeStamp(f.regime)}` : null}
            />
            {compact && <StatusReason reason={why} basis={status.basis} />}
            {f.limits && (
              <SessionCounts
                entries={f.entries}
                entriesMax={f.limits.maxEntries}
                lossRun={f.lossRun}
                lossRunMax={f.limits.maxLossRun}
              />
            )}
          </View>
        )}
        {f.open && <OutcomeActions routineId={routineId} attemptId={f.open.id} write={write} />}
        {!f.open && stop && (
          <StopPanel line={stopLine(stop)} review={ctx.reviewed ? null : review} />
        )}
        {reviewed && (
          <View style={{ gap: 4 }}>
            <ReviewResult
              review={reviewed}
              profile={ctx.profile}
              nextDayStudy={nextDayStudyOnly(state, book, ctx.candle)}
            />
            <LinkButton title="Correct the review" onPress={() => setReviewOf(ctx.candle)} />
          </View>
        )}
        {/* An unknown loss is asked for under a stop too: it holds the next session until reported. */}
        {!f.open && unknownLoss && (
          <LossReport routineId={routineId} attempt={unknownLoss} required write={write} />
        )}
        {!f.open && !stop && f.cooldown && (
          <>
            <CooldownPanel line={cooldownLine(f.cooldown)} loss={f.cooldown.kind === 'loss'} />
            {plannedLoss && !unknownLoss && (
              <LossReport
                routineId={routineId}
                attempt={plannedLoss}
                required={false}
                write={write}
              />
            )}
          </>
        )}
        {code === 'REVIEW_FIRST' && ctx.unreviewed && (
          <CockpitButton
            title={`Review ${displayDate(ctx.unreviewed)}`}
            label={`Review ${displayDate(ctx.unreviewed)} first`}
            look={NEUTRAL}
            onPress={() => setReviewOf(ctx.unreviewed)}
          />
        )}
        {code === 'RESET_ANSWER' && thesis && (
          <ResetActions routineId={routineId} thesisId={thesis.id} write={write} />
        )}
        {code === 'PLAN_RECONFIRM' && <ConfirmPlanButton routineId={routineId} write={write} />}
        {code === 'LINE_BLOCKED' && thesis && (
          <CockpitButton title="Retire this thesis" look={NEUTRAL} onPress={retire} />
        )}
        {RETIRED.includes(code) && (
          // Secondary on purpose: a retired idea is not a reset, and a no-trade day is fine.
          <View style={{ gap: 4 }}>
            <Text style={type.caption}>
              {/* The exhausted wording stays whole here even where the band cuts it. */}
              {code === 'THESIS_EXHAUSTED'
                ? `${status.reason} A no-trade day is fine.`
                : 'A no-trade day is fine.'}
            </Text>
            <OutlineButton
              testID="new-thesis"
              title="New thesis"
              label="Start a new thesis at a different area"
              look={NEUTRAL}
              onPress={() => setOpen('thesis')}
            />
          </View>
        )}
        {f.started && controls && (
          <>
            <LocationControls routineId={routineId} zone={a?.zone ?? null} write={write} />
            {/* Confirming the setup brings the entry and stop into view, where the next tap is. */}
            {(a?.zone === 'at' || a?.confirmed) && (
              <Reveal when={a.confirmed ? 'confirmed' : 'open'}>
                {a?.zone === 'at' && (
                  <SetupControls
                    routineId={routineId}
                    setup={a.setup}
                    fast={!!a.fast}
                    timeframe={a.timeframe}
                    cisd={a.cisd}
                    confirmed={a.confirmed}
                    retakeSet={retakeRuleSet(ctx.profile)}
                    write={write}
                  />
                )}
                {a?.confirmed && (
                  <EntryActions
                    routineId={routineId}
                    entry={a.entry}
                    stop={a.stop}
                    complete={code === 'CHECKS_COMPLETE'}
                    write={write}
                    openRisk={() => setOpen('risk')}
                  />
                )}
              </Reveal>
            )}
            {(f.line?.status === 'normal' || f.line?.status === 'warning') && (
              <MarkBaiting routineId={routineId} where={where} write={write} />
            )}
          </>
        )}
        <StatusNotes notes={notes} />
        {f.started && !stop && !f.open && !f.cooldown && (
          <RegimeControls routineId={routineId} kind={f.regime?.kind ?? null} write={write} />
        )}
        {!f.started && !ctx.reviewed && (
          <Preparation
            ctx={ctx}
            ready={code === 'NOT_STARTED'}
            write={write}
            openLimits={() => setOpen('limits')}
          />
        )}
        <CockpitLinks pages={pages} actions={actions} />
        <Text style={type.caption}>{OWN_REPORT_LINE}</Text>
        {(!f.started || stop) && (
          <TradingProgress book={book} today={today} onReview={setReviewOf} />
        )}
      </Page>
      <TradingReviewSheet
        book={book}
        date={reviewOf ?? ctx.candle}
        visible={reviewOf !== null}
        close={() => setReviewOf(null)}
      />
      <TradingLimitsSheet book={book} visible={open === 'limits'} close={close} />
      {thesis && (
        <RiskSheet
          visible={open === 'risk'}
          close={close}
          routineId={routineId}
          side={thesis.direction}
          target={thesis.target}
          invalidation={thesis.invalidation}
          entry={a?.entry ?? null}
          stop={a?.stop ?? null}
          contracts={a?.contracts ?? null}
          limits={f.limits}
          thesisLeft={f.thesisLeft}
          dailyLeft={f.dailyLeft}
          write={write}
        />
      )}
      <NewThesisSheet
        visible={open === 'thesis'}
        close={close}
        ctx={ctx}
        side={s.bias === 'bearish' || s.bias === 'bullish' ? sideOf(s.bias) : 'long'}
        target={s.plan?.target ?? null}
        write={write}
      />
      <EndSheet visible={open === 'end'} close={close} routineId={routineId} write={write} />
      <LineSheet
        visible={open === 'line'}
        close={close}
        routineId={routineId}
        where={where}
        write={write}
      />
      <TakenSheet
        visible={open === 'taken'}
        close={close}
        routineId={routineId}
        bias={f.bias}
        write={write}
      />
    </>
  );
}

/** How an earlier day stands, in a few words. */
function pastWords(session: TradingSession, reviewed: boolean): string {
  if (reviewed) return 'Review complete';
  if (session.sessionStop || session.doneAt)
    return session.doneReason === 'no-trade' ? 'No trade' : 'Trading done';
  if (session.startedAt) return 'Session left running · review only';
  return 'No session recorded';
}

/**
 * An earlier day: only reviewed. Its session, even one left running, takes nothing more; the
 * thesis card an earlier build committed and the review's result are shown, with the review to
 * record or correct.
 */
function PastDay({ date, today, book }: { date: string; today: string; book: RuleBook }) {
  const { state } = useApp();
  const { session } = useTradingSession(date);
  const [reviewOf, setReviewOf] = useState<string | null>(null);
  const review = candleReview(state, book.routineId, date);
  const offDay = !onTradingSchedule(state, book, date) && !session.startedAt && !review;
  return (
    <Page title="Trading" back top={<Text style={styles.label}>{displayDate(date)}</Text>}>
      <View testID="trading-status" style={[styles.card, { gap: 10, borderColor: palette.edge }]}>
        <Text style={{ ...type.caption, ...fonts.semibold, color: palette.label2 }}>
          {pastWords(session, !!review)}
        </Text>
        {session.bias && <BiasStrip bias={session.bias} size="card" />}
        {session.thesis && !review && <ThesisCardView thesis={session.thesis} />}
        {review ? (
          <>
            <ReviewResult
              review={review}
              profile={book.trading!}
              nextDayStudy={nextDayStudyOnly(state, book, date)}
            />
            <LinkButton title="Correct the review" onPress={() => setReviewOf(date)} />
          </>
        ) : (
          !offDay && <Button title="Review this day" onPress={() => setReviewOf(date)} />
        )}
        <LinkButton
          tone="pill"
          title="Rules & GEX"
          label="Open Rules & GEX: the lock times and the rules"
          onPress={() => router.push('/bias-board')}
        />
      </View>
      <TradingProgress book={book} today={today} onReview={setReviewOf} />
      <Text style={type.caption}>{OWN_REPORT_LINE}</Text>
      <TradingReviewSheet
        book={book}
        date={reviewOf ?? date}
        visible={reviewOf !== null}
        close={() => setReviewOf(null)}
      />
    </Page>
  );
}
