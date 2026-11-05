import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { RuleBook, RuleReview, TradingProfile, displayDate, localDate } from '../domain/model';
import { parseWhole } from '../domain/numbers';
import {
  DaySession,
  NEXT_DAY_STUDY_LINE,
  DisciplineDraft,
  TradingSession,
  dayAwayOffered,
  disciplineAnswered,
  disciplineFromRecords,
  disciplineViolations,
  forcedViolations,
  processScore,
  reviewEditedText,
  saveTradingReview,
  sessionResult,
  candleReview,
  reviewWaitsForOutcome,
  studyOnlyDay,
} from '../domain/trading';
import { NOT_VERIFIED_LINE } from '../domain/trading-live';
import { failedAttempt } from '../domain/trading-live-model';
import { DISCIPLINE_QUESTIONS } from '../domain/trading-rules';
import { liveDiscipline, reviewFacts } from '../domain/trading-status';
import { useApp } from '../state/app-state';
import { announce } from './announce';
import { Button, Field, Sheet, styles } from './components';
import { Disclosure, Segmented } from './controls';
import { newId } from './ids';
import { Tick } from './mission';
import { ThesisCardView } from './trading-thesis';
import { useTradingSession } from './use-trading-session';
import { fonts, palette, radius, type } from './theme';

/** Under Save review while a trade is still open on the day's session. */
const OPEN_TRADE_REVIEW_LINE =
  'A trade is still open. Record its outcome on the cockpit before the review.';

type Answer = 'yes' | 'no';

/**
 * Two answers for one item, neither chosen until the user picks (or the session pre-fills it):
 * 44 pt capsules, the chosen one a 2 pt ring with a check in Fern for the good answer and the
 * danger color for the other, so the answer never rests on color alone.
 */
function TwoWay<T extends string | boolean>({
  title,
  value,
  onChange,
  options,
}: {
  title: string;
  value: T | null | undefined;
  onChange: (v: T) => void;
  /** The good answer first: [value, shown word, spoken word]. */
  options: [[T, string, string], [T, string, string]];
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={title}
      style={{ flexDirection: 'row', gap: 6 }}>
      {options.map(([v, word, spoken], i) => {
        const on = value === v;
        const tone = i === 0 ? palette.doneText : palette.danger;
        return (
          <Pressable
            key={String(v)}
            accessibilityRole="radio"
            accessibilityLabel={`${title}: ${spoken}`}
            accessibilityState={{ checked: on }}
            aria-checked={on}
            onPress={() => onChange(v)}
            style={{
              minWidth: 64,
              minHeight: 44,
              paddingHorizontal: 10,
              borderRadius: radius.capsule,
              borderWidth: 2,
              borderColor: on ? tone : palette.fill,
              backgroundColor: on
                ? i === 0
                  ? palette.doneTint
                  : palette.dangerTint
                : palette.fill,
              flexDirection: 'row',
              gap: 4,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            {on && <Tick color={tone} small />}
            <Text
              maxFontSizeMultiplier={1.3}
              style={{
                ...fonts.semibold,
                fontSize: 14,
                lineHeight: 18,
                color: on ? tone : palette.label2,
              }}>
              {word}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Pass and Fail for one checklist item. */
function PassFail({
  title,
  value,
  onChange,
}: {
  title: string;
  value: Answer | undefined;
  onChange: (v: Answer) => void;
}) {
  return (
    <TwoWay
      title={title}
      value={value}
      onChange={onChange}
      options={[
        ['yes', 'Pass', 'pass'],
        ['no', 'Fail', 'fail'],
      ]}
    />
  );
}

/** Yes and No for one discipline question. */
function YesNoAnswer({
  title,
  value,
  onChange,
}: {
  title: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <TwoWay
      title={title}
      value={value}
      onChange={onChange}
      options={[
        [true, 'Yes', 'yes'],
        [false, 'No', 'no'],
      ]}
    />
  );
}

function ItemTitle({ n, title }: { n: number; title: string }) {
  return (
    <Text style={type.item}>
      <Text style={{ ...fonts.figure, color: palette.label3 }}>{n} </Text>
      {title}
    </Text>
  );
}

/** A saved review's result: the score, clean or rule-broken, and whether it was edited. */
export function ReviewResult({
  review,
  profile,
  nextDayStudy,
}: {
  review: RuleReview;
  profile: TradingProfile;
  nextDayStudy: boolean;
}) {
  const result = sessionResult(review, profile);
  const score = result === 'away' ? null : processScore(review, profile).passed;
  const edited = reviewEditedText(review);
  const tone =
    result === 'clean' ? palette.done : result === 'broken' ? palette.danger : palette.label2;
  return (
    <View testID="review-result" accessible accessibilityRole="header" style={{ gap: 2 }}>
      <Text style={{ ...type.figure, color: tone }}>
        {result === 'away' ? 'Day away' : `${score}/8`}
      </Text>
      <Text style={{ ...type.callout, color: tone }}>
        {result === 'clean'
          ? 'Clean session'
          : result === 'broken'
            ? 'Rule-broken session'
            : 'Planned day away from trading'}
      </Text>
      <Text style={type.caption}>
        {result === 'clean'
          ? review.trading?.session === 'no-trade'
            ? 'Rules followed. No valid setup, no trade: that is a win.'
            : 'Rules followed.'
          : result === 'broken'
            ? review.violations.length
              ? `${review.violations.length} hard violation${review.violations.length === 1 ? '' : 's'} · the review is what counts.${nextDayStudy ? ` ${NEXT_DAY_STUDY_LINE}` : ''}`
              : 'The review is what counts.'
            : 'Not scored.'}
      </Text>
      {edited && <Text style={type.caption}>{edited}</Text>}
    </View>
  );
}

/** What the session's records say, each marked Recorded: derived, never the user's answer. */
function RecordedFacts({ session }: { session: TradingSession }) {
  const { facts, counts } = reviewFacts(session);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const summary = [
    `${counts.theses} ${counts.theses === 1 ? 'thesis' : 'theses'}`,
    plural(counts.attempts, 'attempt'),
    `${counts.failed} failed`,
    ...(counts.exceptions ? [plural(counts.exceptions, 'exception')] : []),
    ...(counts.baiting ? [`${counts.baiting} baiting`] : []),
    ...(counts.invalidatedLines ? [`${counts.invalidatedLines} line invalidated`] : []),
    ...(counts.taken ? [`${counts.taken} taken outside the cockpit`] : []),
    ...(counts.refused ? [`${counts.refused} I ENTERED refused`] : []),
  ].join(' · ');
  return (
    <View testID="review-recorded" style={{ gap: 4 }}>
      <Text accessibilityRole="header" style={{ ...type.meta, paddingTop: 6 }}>
        Recorded · from the session
      </Text>
      <Text style={{ ...type.caption, color: palette.label }}>{summary}</Text>
      {facts
        .filter((f) => f.value !== null)
        .map((f) => (
          <View
            key={f.key}
            accessible
            accessibilityLabel={`${f.label}: ${f.value ? 'yes' : 'no'}. Recorded.`}
            style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Text
              style={{
                ...fonts.figure,
                fontSize: 13,
                width: 14,
                color: f.value ? palette.label2 : palette.danger,
              }}>
              {f.value ? '✓' : '×'}
            </Text>
            <Text
              style={{
                ...type.caption,
                flex: 1,
                color: f.value ? palette.label2 : palette.danger,
              }}>
              {f.label}
            </Text>
          </View>
        ))}
      <Text style={{ ...type.caption, fontSize: 12 }}>
        {`Recorded from timestamps and your reports in the cockpit. ${NOT_VERIFIED_LINE}.`}
      </Text>
    </View>
  );
}

/**
 * The day's process: eight PASS / FAIL rows, the score as it stands, hard violations folded away,
 * and one Save. A planned day away is its own quiet action, offered only when no session started.
 * The candle's saved session supplies the committed thesis card (shown read-only), the
 * logged entry count and the violations its log points to. Nothing asks for money, prices or a
 * trade log.
 */
export function TradingReviewSheet({
  book,
  date,
  visible,
  close,
}: {
  book: RuleBook;
  date: string;
  visible: boolean;
  close: () => void;
}) {
  return visible ? <LoadedReview key={date} book={book} date={date} close={close} /> : null;
}

/**
 * Waits for the saved data, then reads the candle's session. A session that cannot be read is left
 * out, and is never taken for a day without one.
 */
function LoadedReview({ book, date, close }: { book: RuleBook; date: string; close: () => void }) {
  const { session, loaded, loadFailed } = useTradingSession(date);
  if (!loaded && !loadFailed) return null;
  return (
    <ReviewForm
      book={book}
      date={date}
      daySession={loaded ? session : null}
      sessionUnread={!loaded}
      close={close}
    />
  );
}

function ReviewForm({
  book,
  date,
  daySession,
  sessionUnread,
  close,
}: {
  book: RuleBook;
  date: string;
  daySession: TradingSession | null;
  /** The day's session could not be read: whether one started is unknown. */
  sessionUnread: boolean;
  close: () => void;
}) {
  const { state, change } = useApp();
  const profile = book.trading!;
  // The candle's review: on its date, or where an earlier build saved it (`candleReview`).
  const existing = candleReview(state, book.routineId, date);
  const reviewed = existing?.outcome === 'reviewed';
  // Hard violations already saved stay recorded: a correction can add, never take back.
  const earlier = reviewed ? existing.violations : [];
  const thesis = existing?.trading?.thesis ?? daySession?.thesis;
  const logged = existing?.trading?.entryLog?.length ?? daySession?.entries?.length ?? 0;
  // The live cockpit's attempts: each one an execution, however many accounts it was copied to.
  const attempts = daySession?.attempts ?? [];
  const failedAttempts = attempts.filter(failedAttempt).length;
  const [answers, setAnswers] = useState<Record<string, Answer>>(() =>
    existing?.trading?.session === 'away'
      ? {}
      : Object.fromEntries(
          (existing?.answers ?? []).map((a) => [a.checkpointId, a.answer as Answer]),
        ),
  );
  // No trade decided, or a study-only day without a session, starts as No trade taken.
  const [session, setSession] = useState<'traded' | 'no-trade'>(() =>
    existing?.trading?.session === 'no-trade' ||
    (!existing &&
      !logged &&
      !attempts.length &&
      (daySession?.doneReason === 'no-trade' ||
        !!daySession?.lock ||
        (!daySession?.startedAt && !!studyOnlyDay(state, book, date))))
      ? 'no-trade'
      : 'traded',
  );
  // The six discipline answers: as saved on a correction, else pre-filled from the session where
  // the records can tell, each still the user's to change. A review saved before them needs none.
  // A day this device holds nothing for (no bias, no start, no end) tells nothing.
  const recorded =
    daySession &&
    (daySession.bias || daySession.preflight || daySession.startedAt || daySession.doneAt)
      ? daySession
      : null;
  const fromSession = (recorded && liveDiscipline(recorded)) ?? disciplineFromRecords(recorded);
  const [discipline, setDiscipline] = useState<DisciplineDraft>(
    () => existing?.trading?.discipline ?? fromSession,
  );
  const derived =
    !existing?.trading?.discipline && Object.values(fromSession).some((v) => v !== null)
      ? fromSession
      : null;
  const disciplineNeeded = !existing || !!existing.trading?.discipline;
  const [chosen, setChosen] = useState<string[]>(existing?.violations ?? []);
  // Violations an answer points to that the user unticked before the first save.
  const [cleared, setCleared] = useState<string[]>([]);
  const [entries, setEntries] = useState(
    String(existing?.trading?.entries ?? (existing ? '' : logged || attempts.length || '')),
  );
  const [failed, setFailed] = useState(
    String(existing?.trading?.failedTheses ?? (daySession?.failedTheses || failedAttempts || '')),
  );
  const [note, setNote] = useState(existing?.note ?? '');
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Until the first save, the violations the session's records point to are recorded whatever is
  // ticked (`forcedViolations`), so they are shown ticked and locked; a correction keeps what was
  // saved. Those an answer points to are pre-selected until the first save.
  const fromRecords = forcedViolations(profile, existing, daySession);
  const fromLog = reviewed
    ? fromRecords
    : [...new Set([...fromRecords, ...disciplineViolations(profile, discipline)])];
  const violations = [
    ...chosen,
    ...fromLog.filter((id) => !chosen.includes(id) && !cleared.includes(id)),
  ];
  // A violation recorded before it was removed from the list stays visible, and stays recorded.
  const listed = [
    ...profile.violations,
    ...violations
      .filter((id) => !profile.violations.some((v) => v.id === id))
      .map((id) => ({ id, title: 'A violation no longer in your list', details: '' })),
  ];
  const toggle = (id: string) => {
    if (fromRecords.includes(id)) return;
    if (violations.includes(id)) {
      setChosen(chosen.filter((x) => x !== id));
      if (fromLog.includes(id)) setCleared([...cleared, id]);
    } else {
      setChosen([...chosen, id]);
      setCleared(cleared.filter((x) => x !== id));
    }
  };
  const answeredItems = profile.checklist.filter((c) => answers[c.id]).length;
  const passed = profile.checklist.filter((c) => answers[c.id] === 'yes').length;
  const disciplineDone = disciplineAnswered(discipline);
  const disciplineLeft = disciplineNeeded
    ? DISCIPLINE_QUESTIONS.filter((q) => discipline[q.key] === null).length
    : 0;
  const disciplineYes = DISCIPLINE_QUESTIONS.filter((q) => discipline[q.key] === true).length;
  const total = profile.checklist.length + (disciplineNeeded ? DISCIPLINE_QUESTIONS.length : 0);
  const answered =
    answeredItems + (disciplineNeeded ? DISCIPLINE_QUESTIONS.length - disciplineLeft : 0);
  const complete = answered === total;
  // Unknown whether a session started, a day away is not offered rather than assumed possible.
  const found: DaySession = sessionUnread ? 'unread' : daySession;
  const awayOffered = dayAwayOffered(existing, found);
  const running = !existing && !!daySession?.startedAt && !daySession.doneAt;
  // A day that ends during a trade still asks for its outcome: the review copies the session's log
  // as it is, so it waits until the open trade's outcome is recorded on the cockpit.
  const tradeOpen = !existing && reviewWaitsForOutcome(daySession);
  const disciplined = !disciplineDone || disciplineYes === DISCIPLINE_QUESTIONS.length;
  const clean =
    complete && passed === profile.checklist.length && violations.length === 0 && disciplined;
  const save = async (away: boolean) => {
    if (tradeOpen) return;
    try {
      const ok = await change((s) =>
        saveTradingReview(
          s,
          {
            date,
            routineId: book.routineId,
            session: away ? 'away' : session,
            answers,
            violations,
            entries: parseWhole(entries),
            failedTheses: parseWhole(failed),
            note,
            ...(disciplineDone && { discipline }),
            daySession: found,
          },
          newId('trading-review'),
          new Date().toISOString(),
        ),
      );
      if (ok) close();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Check the review.';
      setError(message);
      // Text alone is never heard on iOS. A failed save is the app's error, spoken at the root.
      announce(message);
    }
  };
  return (
    <Sheet
      title={`${date === localDate() ? "Today's process" : 'Process'} · ${displayDate(date)}`}
      visible
      close={close}>
      <Segmented
        label="Session"
        options={[
          ['traded', 'Traded'],
          ['no-trade', 'No trade taken'],
        ]}
        value={session}
        onChange={setSession}
      />
      {session === 'no-trade' && (
        <Text style={type.caption}>
          A deliberate session without a trade can be clean. For items about trades, PASS means no
          trade broke the rule.
        </Text>
      )}
      {daySession && (daySession.lock || attempts.length > 0) && (
        <RecordedFacts session={daySession} />
      )}
      {thesis && (
        <ThesisCardView
          thesis={thesis}
          note="As committed before the session. Review the day against it."
        />
      )}
      <View style={{ gap: 2 }}>
        {profile.checklist.map((item, i) => (
          <View
            key={item.id}
            style={{
              paddingVertical: 6,
              borderTopWidth: i ? 1 : 0,
              borderTopColor: palette.separator,
              gap: 4,
            }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {/* An item without details has nothing to fold, so it is plain text. */}
              {item.details ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}. ${open === item.id ? 'Hide' : 'Show'} details`}
                  accessibilityState={{ expanded: open === item.id }}
                  aria-expanded={open === item.id}
                  onPress={() => setOpen(open === item.id ? null : item.id)}
                  style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}>
                  <ItemTitle n={i + 1} title={item.title} />
                </Pressable>
              ) : (
                <View style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}>
                  <ItemTitle n={i + 1} title={item.title} />
                </View>
              )}
              <PassFail
                title={item.title}
                value={answers[item.id]}
                onChange={(v) => setAnswers({ ...answers, [item.id]: v })}
              />
            </View>
            {open === item.id && !!item.details && <Text style={type.caption}>{item.details}</Text>}
          </View>
        ))}
      </View>
      <View testID="review-discipline" style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={{ ...type.meta, paddingTop: 6 }}>
          Discipline
        </Text>
        <Text style={type.caption}>
          {derived
            ? 'Pre-filled from the session where it can be told. Change any answer before saving. Profit never enters it.'
            : 'Yes or No for each. Profit never enters it.'}
        </Text>
        {DISCIPLINE_QUESTIONS.map((q, i) => (
          <View
            key={q.key}
            style={{
              paddingVertical: 6,
              borderTopWidth: i ? 1 : 0,
              borderTopColor: palette.separator,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}>
            <View style={{ flex: 1, minHeight: 44, justifyContent: 'center', gap: 1 }}>
              <Text style={type.item}>{q.text}</Text>
              {derived && derived[q.key] !== null && derived[q.key] === discipline[q.key] ? (
                <Text style={{ ...type.caption, fontSize: 12 }}>Recorded</Text>
              ) : (
                discipline[q.key] !== null && (
                  <Text style={{ ...type.caption, fontSize: 12 }}>Your report</Text>
                )
              )}
            </View>
            <YesNoAnswer
              title={q.text}
              value={discipline[q.key]}
              onChange={(v) => setDiscipline({ ...discipline, [q.key]: v })}
            />
          </View>
        ))}
      </View>
      <Disclosure
        plain
        title="Record violation"
        summary={violations.length ? `${violations.length} recorded` : undefined}
        initiallyOpen={violations.length > 0}>
        <Text style={type.caption}>
          A hard violation makes the session rule-broken.
          {earlier.length ? ' One recorded earlier stays recorded.' : ''}
        </Text>
        <View style={{ gap: 8 }}>
          {listed.map((v) => {
            const on = violations.includes(v.id);
            const locked = earlier.includes(v.id) || fromRecords.includes(v.id);
            const note = fromRecords.includes(v.id)
              ? 'Recorded from the session'
              : earlier.includes(v.id)
                ? 'Recorded earlier'
                : on && fromLog.includes(v.id) && !chosen.includes(v.id)
                  ? 'From your answer'
                  : null;
            return (
              <Pressable
                key={v.id}
                accessibilityRole="checkbox"
                accessibilityLabel={note ? `${v.title}, ${note.toLowerCase()}` : v.title}
                accessibilityState={{ checked: on, disabled: locked }}
                aria-checked={on}
                aria-disabled={locked}
                disabled={locked}
                onPress={() => toggle(v.id)}
                style={{
                  minHeight: 44,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: radius.control,
                  borderWidth: 1,
                  borderColor: on ? palette.danger : palette.separator,
                  backgroundColor: on ? palette.dangerTint : palette.canvas,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                }}>
                <Text
                  style={{
                    ...fonts.figure,
                    fontSize: 14,
                    width: 14,
                    color: palette.danger,
                  }}>
                  {on ? '×' : ''}
                </Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    style={{
                      ...type.item,
                      fontSize: 14,
                      color: on ? palette.danger : palette.label,
                    }}>
                    {v.title}
                  </Text>
                  {note && <Text style={{ ...type.caption, fontSize: 12 }}>{note}</Text>}
                </View>
              </Pressable>
            );
          })}
        </View>
      </Disclosure>
      <View
        accessible
        accessibilityLabel={`Process score ${passed} of ${profile.checklist.length}. ${violations.length} hard violations.${disciplineNeeded ? ` Discipline ${disciplineYes} of ${DISCIPLINE_QUESTIONS.length} yes.` : ''} ${
          complete
            ? clean
              ? 'Clean session'
              : 'Rule-broken session'
            : `${total - answered} items left`
        }`}
        accessibilityLiveRegion="polite"
        aria-live="polite"
        style={{
          gap: 4,
          padding: 14,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: !complete ? palette.separator : clean ? palette.doneEdge : palette.danger,
          backgroundColor: palette.canvas,
        }}>
        <Text style={{ ...type.value, color: clean ? palette.done : palette.label }}>
          Process score {passed}/{profile.checklist.length}
        </Text>
        <Text style={type.caption}>Hard violations: {violations.length}</Text>
        {disciplineNeeded && (
          <Text style={type.caption}>
            Discipline: {disciplineYes} of {DISCIPLINE_QUESTIONS.length} Yes
          </Text>
        )}
        <Text
          style={{
            ...type.callout,
            color: !complete ? palette.accent : clean ? palette.done : palette.danger,
          }}>
          {!complete
            ? `${total - answered} left to answer`
            : clean
              ? 'Clean session'
              : 'Rule-broken session'}
        </Text>
        {complete &&
          passed === profile.checklist.length &&
          violations.length === 0 &&
          !disciplined && (
            <Text style={type.caption}>
              Every item is PASS, but a discipline answer is No: the session is rule-broken.
            </Text>
          )}
        {complete && passed === profile.checklist.length && violations.length > 0 && (
          <Text style={type.caption}>
            Every item is PASS, but a hard violation is recorded. Check the items it relates to;
            nothing is changed for you.
          </Text>
        )}
      </View>
      {session === 'traded' && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Field label="Entries taken · optional" value={entries} onChange={setEntries} numeric />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Failed theses · optional" value={failed} onChange={setFailed} numeric />
          </View>
        </View>
      )}
      {session === 'traded' && logged > 0 && (
        <Text style={type.caption}>
          {`${logged} ${logged === 1 ? 'entry' : 'entries'} logged in this session: every logged entry counts, so entries taken is never fewer.`}
        </Text>
      )}
      <Field
        label="The one thing to improve tomorrow · optional"
        value={note}
        onChange={setNote}
        name
        multiline
      />
      {error && (
        <Text accessibilityRole="alert" style={styles.alert}>
          {error}
        </Text>
      )}
      {running && !tradeOpen && (
        <Text style={type.caption}>
          The session is still running. Saving the review ends trading for this daily candle: no
          entry is logged after it.
        </Text>
      )}
      <Button
        title="Save review"
        disabled={!complete || tradeOpen}
        needs={tradeOpen ? OPEN_TRADE_REVIEW_LINE : ''}
        label={
          tradeOpen
            ? 'Save review: record the open trade first'
            : complete
              ? 'Save review'
              : `Save review: ${total - answered} items left`
        }
        onPress={() => void save(false)}
      />
      {/* A day away only for a day with no reviewed session and no session started. */}
      {awayOffered && (
        <Button
          secondary
          small
          title="Planned day away from trading"
          onPress={() => void save(true)}
        />
      )}
      {sessionUnread && dayAwayOffered(existing, null) && (
        <Text style={type.caption}>
          This device could not read the day&apos;s session, so Planned day away is not offered.
        </Text>
      )}
    </Sheet>
  );
}
