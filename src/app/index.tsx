import {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useApp } from '../state/app-state';
import { replaceAllState } from '../state/session-store';
import { sessionStore } from '../data/timer-store';
import {
  Block,
  clock,
  dateObject,
  displayDate,
  displayTime,
  localDate,
  parseTime,
  shiftDate,
  weekdayShort,
} from '../domain/model';
import { withDay } from '../domain/data';
import { demoState, isBlank } from '../domain/demo';
import {
  clearDayProtection,
  dayClearStreak,
  dayOutcome,
  dayProgress,
  protectDay,
  streakHistory,
} from '../domain/objectives';
import { editBlock, generateDay, makeBlock, replanDay, setStatus } from '../domain/planner';
import { Button, Field, Page, SectionLabel, Sheet, styles } from '../ui/components';
import { Disclosure, LinkButton } from '../ui/controls';
import { RestoreDone, RestoreSheet, useRestore } from '../ui/restore-sheet';
import {
  ObjectiveBoard,
  StreakSheetBody,
  streakDetailsLabel,
  streakLine,
} from '../ui/objective-board';
import { RestedWorkoutRow, RowActions, TodayRow } from '../ui/today-row';
import { RowList, doneAt } from '../ui/objective-row';
import { TodayHero } from '../ui/today-hero';
import { MorningCaption, morningTrail } from '../ui/morning-trail';
import { PressableScale } from '../ui/motion';
import { DayNav, PinnedProgress } from '../ui/today-top';
import { announce } from '../ui/announce';
import { palette, type, useWash } from '../ui/theme';
import { doneSets, routineOf, sessionFor, templateFor, undoWorkout } from '../domain/workouts';
import { CATEGORY_LABELS, logFor } from '../domain/lifelog';
import { evidenceNote, recordKind, type RecordKind } from '../domain/linked';
import { WorkoutSheet, WorkoutTarget } from '../ui/workout-sheet';
import { WeightSheet, WeightTarget } from '../ui/weight-sheet';
import { MoneySheet, MoneyTarget } from '../ui/money-sheet';
import { ActivitySheet, ActivityTarget } from '../ui/activity-sheet';
import { RulesSheet, RulesTarget } from '../ui/rules-sheet';
import { LogSheet, LogTarget } from '../ui/log-sheet';
import { ShiftSheet, ShiftTarget } from '../ui/shift-sheet';
import { CompanionMoveSheet, CompanionMoveTarget } from '../ui/companion-move-sheet';
import {
  ensureDay,
  isRestDay,
  needsEnsure,
  nextWorkout,
  planKeep,
  projectedWorkouts,
  restedByChoice,
  skipObjective,
  trainDay,
} from '../domain/rotation';
import { CircuitTarget, CircuitTimer } from '../ui/circuit-timer';
import {
  activeCircuitLine,
  circuitFor,
  circuitSessionFor,
  clockText,
  totalSeconds,
} from '../domain/intervals';
import {
  fullStudy,
  minutesLine,
  phaseAt,
  planMinutes,
  studyPlanFor,
  studySessionFor,
} from '../domain/study';
import { StudySession, StudyTarget } from '../ui/study-session';
import { CarriedStudyCard } from '../ui/study-card';
import { StudyRow } from '../ui/study-row';
import { StudyPlanEditor } from '../ui/study-plan-editor';
import { TomorrowPreview } from '../ui/tomorrow-preview';
import { useCircuitRuns, useStudyRuns } from '../ui/use-study-runs';
import { loadStudyRun } from '../data/study-store';
import { dayListOrder, nextOpen, todayList } from '../domain/day-order';
import { clearedTitles, greeting, recordedSub, timeRange } from '../ui/today-text';
import { currentPriority } from '../domain/money';
import { backupReminder } from '../domain/backup-reminder';
import { MoneyPriorityCard } from '../ui/money-priority';
import { tradingBook } from '../domain/trading';
import { TradingRow } from '../ui/trading-card';
import { TodayFocus } from '../ui/focus-card';
import { activeFocus } from '../domain/focus';
import { Celebration } from '../ui/celebration';
import { dayMoments, streakStep, weekMarks } from '../domain/moments';
import { anchorCaption, anchorRoutine } from '../domain/anchor';
import { MorningCorrection } from '../ui/morning-correction';
import { DayOrderSheet } from '../ui/day-order-sheet';
import { IconTile, Row, Toggle } from '../ui/list';
import { newId } from '../ui/ids';

function actionLabel(block: Block): string {
  return block.status === 'planned' ? `Mark ${block.title} done` : `Undo ${block.title}`;
}

/** A fresh id for a block added by hand; only ever called from a press handler. */
function manualBlockId(date: string): string {
  return `${date}:manual:${newId('block')}`;
}

const NO_LINKS: never[] = [];

export default function TodayScreen() {
  const { state, change, ready } = useApp(),
    params = useLocalSearchParams<{ date?: string }>();
  const [selection, setSelection] = useState<{
      base: string;
      date: string;
    } | null>(null),
    [now, setNow] = useState(new Date()),
    [editing, setEditing] = useState<Block | null>(null),
    // The day the open block sheet edits, kept when the sheet opened so a midnight rollover behind
    // it never moves the edit onto the new day.
    [editingDate, setEditingDate] = useState<string | null>(null);
  const [title, setTitle] = useState(''),
    [time, setTime] = useState(''),
    [duration, setDuration] = useState(''),
    [fixed, setFixed] = useState(false),
    [formError, setFormError] = useState<string | null>(null),
    [streakOpen, setStreakOpen] = useState(false),
    [workoutTarget, setWorkoutTarget] = useState<WorkoutTarget | null>(null),
    [weightTarget, setWeightTarget] = useState<WeightTarget | null>(null),
    [moneyTarget, setMoneyTarget] = useState<MoneyTarget | null>(null),
    [logTarget, setLogTarget] = useState<LogTarget | null>(null),
    [shiftTarget, setShiftTarget] = useState<ShiftTarget | null>(null),
    [companionMove, setCompanionMove] = useState<CompanionMoveTarget | null>(null),
    [circuitTarget, setCircuitTarget] = useState<CircuitTarget | null>(null),
    [activityTarget, setActivityTarget] = useState<ActivityTarget | null>(null),
    [rulesTarget, setRulesTarget] = useState<RulesTarget | null>(null),
    [studyTarget, setStudyTarget] = useState<StudyTarget | null>(null),
    [studyPlanOf, setStudyPlanOf] = useState<string | null>(null),
    [studyVersion, setStudyVersion] = useState(0),
    [circuitVersion, setCircuitVersion] = useState(0),
    [orderOpen, setOrderOpen] = useState(false),
    // Once the board has scrolled away, a thin bar under the header keeps the day's progress.
    [boardAway, setBoardAway] = useState(false),
    // The date whose first save failed, so Today stops waiting for it.
    [unsaved, setUnsaved] = useState<string | null>(null);
  let base = localDate(now);
  if (params.date) {
    try {
      dateObject(params.date);
      base = params.date;
    } catch {}
  }
  const date = selection?.base === base ? selection.date : base;
  // Where the board ends in the scrolling content.
  const boardEnd = useRef(0);
  // The demo replaces everything, so it is offered only when there is nothing to lose.
  const blank = isBlank(state);
  // Restore my backup on the empty Today: after a reinstall or on a new phone, the first thing.
  const restore = useRestore();
  const today = localDate(now);
  const setDate = (next: string) => setSelection({ base, date: next });
  useEffect(() => {
    // Only a new minute changes what Today shows, so a check within the same minute renders nothing.
    const timer = setInterval(() => {
      const next = new Date();
      setNow((last) =>
        Math.floor(last.getTime() / 60_000) === Math.floor(next.getTime() / 60_000) ? last : next,
      );
    }, 30_000);
    return () => clearInterval(timer);
  }, []);
  useFocusEffect(
    useCallback(() => {
      return () => setEditing(null);
    }, []),
  );
  useEffect(() => {
    if (!ready || !state.programs.length) return;
    if (date < today) return;
    // Workouts with logged sets are kept, so their sets always stay reachable.
    // Rotation workouts and companions are due here too (see domain/rotation).
    if (!needsEnsure(state, date, today)) return;
    // The check and the write share one clock, so a midnight rollover cannot loop saves.
    const at = now.toISOString();
    void change((s) => ensureDay(s, date, at)).then((saved) => setUnsaved(saved ? null : date));
  }, [ready, date, today, now, state, change]);
  // Until that save lands, a day not saved yet would read as empty; nothing says so meanwhile.
  // Once it fails, the empty-day copy returns under the error, so the page is never blank.
  const preparing =
    ready &&
    !!state.programs.length &&
    date >= today &&
    unsaved !== date &&
    needsEnsure(state, date, today);
  const day = state.days[date] ?? { date, blocks: [], revisions: [] },
    minute = now.getHours() * 60 + now.getMinutes();
  const scheduled = day.blocks
      .filter((b) => b.start !== null && !b.checklist)
      .sort((a, b) => a.start! - b.start!),
    checklist = day.blocks.filter((b) => b.checklist),
    overflow = day.blocks.filter((b) => b.start === null && !b.checklist);
  const isToday = date === today;
  const next = scheduled.find(
    (b) =>
      b.status === 'planned' &&
      (!isToday || (b.duration == null ? b.start! >= minute : b.start! + b.duration > minute)),
  );
  const happening = !!(next && isToday && next.start! <= minute);
  const progress = dayProgress(day, state.programs, date);
  const outcome = dayOutcome(state, date);
  // Read once per saved state and date, not on every clock tick or keystroke in a sheet.
  const streak = useMemo(() => dayClearStreak(state, date, today), [state, date, today]);
  // The Day Cleared reveal plays only when the viewed day turns cleared while this screen is showing
  // it: not when the app opens, not when returning to Today, not when switching dates. State only
  // changes after a save succeeds, so an unsaved clear never plays it.
  // Today stays mounted under pages opened on top (Trading, Settings, Backup): a day cleared there,
  // or by a restore, is not celebrated here, now or when Today comes back into view.
  const [inView, setInView] = useState(false);
  const clearSeen = ready ? { date, cleared: progress.cleared } : null;
  const [lastSeen, setLastSeen] = useState(clearSeen);
  const [celebrated, setCelebrated] = useState<string | null>(null);
  if (clearSeen?.date !== lastSeen?.date || clearSeen?.cleared !== lastSeen?.cleared) {
    setLastSeen(clearSeen);
    setCelebrated(
      inView && clearSeen?.cleared && lastSeen?.date === clearSeen.date && !lastSeen.cleared
        ? clearSeen.date
        : null,
    );
  }
  // The full celebration follows the same rule, for today only, and once per day once closed.
  const [closedParty, setClosedParty] = useState<string | null>(null);
  const party = celebrated === date && isToday && inView && closedParty !== date;
  const week = useMemo(() => weekMarks(state, date, today), [state, date, today]);
  // State only changes after a save succeeds, so this never announces an unsaved clear. Loading saved
  // data and changes made while another screen is focused are not announced as if just achieved.
  const lastClear = useRef<{ date: string; cleared: boolean } | null>(null);
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      setInView(true);
      return () => {
        focused.current = false;
        setInView(false);
      };
    }, []),
  );
  useEffect(() => {
    const previous = lastClear.current;
    lastClear.current = ready ? { date, cleared: progress.cleared } : null;
    if (!ready || !focused.current) return;
    if (previous?.date !== date || previous.cleared === progress.cleared) return;
    announce(
      progress.cleared
        ? `Day cleared. ${progress.done} of ${progress.total} objectives complete.`
        : 'Day no longer cleared.',
    );
  }, [ready, date, progress.cleared, progress.done, progress.total]);
  // A routine's occurrence edits this day only; the routine itself is changed in Programs.
  const editedRoutine =
    editing?.routineId &&
    state.programs.some((p) => p.routines.some((r) => r.id === editing.routineId))
      ? editing.routineId
      : null;
  const open = (b?: Block, on = date) => {
    const value = b ?? makeBlock(manualBlockId(on), '', null, 30);
    setEditing(value);
    setEditingDate(on);
    setTitle(value.title);
    setTime(value.start === null ? '' : clock(value.start));
    setDuration(String(value.duration ?? ''));
    setFixed(value.fixed);
    setFormError(null);
  };
  const save = async () => {
    try {
      if (!editing) return;
      const target = editingDate ?? date;
      // A checklist item is a completion item, never a calendar slot: it keeps no start time.
      const checklistItem = !!editing.checklist;
      const timed = !checklistItem && !!time.trim();
      const changed = {
        ...editing,
        title: title.trim(),
        start: timed ? parseTime(time) : null,
        duration: duration.trim() ? Number(duration) : null,
        fixed: checklistItem ? editing.fixed : fixed,
        // A day that is over is never asked to schedule anything.
        reason: checklistItem || timed || target < today ? null : 'Choose a time when this fits.',
      };
      const okay = await change((s) =>
        withDay(
          s,
          editBlock(
            s.days[target] ?? { date: target, blocks: [], revisions: [] },
            changed,
            s.settings,
          ),
        ),
      );
      if (okay) setEditing(null);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Check these details.');
    }
  };
  const mark = (block: Block, status: Block['status']) =>
    change((s) => withDay(s, setStatus(s.days[date], block.id, status)));
  const toggle = (block: Block) => mark(block, block.status === 'planned' ? 'done' : 'planned');
  // Objectives that record something open their form instead of being ticked off.
  const trading = tradingBook(state);
  const isTrading = (block: Block) => !!trading && block.routineId === trading.routineId;
  const kindOf = (block: Block): RecordKind | null => recordKind(state, block);
  // Study sessions in progress on this device, for the study row's caption and Timer.
  const studyBlocks = day.blocks.filter((b) => studyPlanFor(state, b.routineId));
  // A session started yesterday and still open (it crossed midnight) stays reachable from today.
  const yesterday = shiftDate(today, -1);
  const carried =
    date === today
      ? (state.days[yesterday]?.blocks ?? []).filter(
          (b) => b.status === 'planned' && studyPlanFor(state, b.routineId),
        )
      : [];
  const studyRuns = useStudyRuns(
    [...studyBlocks, ...carried].map((b) => b.id),
    studyVersion,
  );
  // Circuits in progress on this device, so the row says a run is paused there.
  const circuitRuns = useCircuitRuns(
    day.blocks
      .filter((b) => b.status !== 'done' && circuitFor(state, b.routineId))
      .map((b) => b.id),
    circuitVersion,
  );
  const openRecord = (block: Block, kind: RecordKind) => {
    const occurrence = { date, block };
    if (kind === 'workout') setWorkoutTarget(occurrence);
    else if (kind === 'circuit') setCircuitTarget(occurrence);
    else if (kind === 'study') setStudyTarget(occurrence);
    else if (kind === 'weight') setWeightTarget({ occurrence });
    else if (kind === 'activity') setActivityTarget({ occurrence });
    else if (kind === 'rules') setRulesTarget({ occurrence });
    else if (kind === 'trading') router.push({ pathname: '/trading', params: { date } });
    else setMoneyTarget({ occurrence });
  };
  // Study completes with one tap; only a timer session in progress goes through its own screen,
  // so its timed work is never dropped.
  const timerOpen = (block: Block) => kindOf(block) === 'study' && !!studyRuns[block.id];
  // Returns the save's promise when the press saves, so the row's check shows it is saving.
  const check = (block: Block): Promise<unknown> | undefined => {
    const kind = kindOf(block);
    if (block.status === 'planned' && kind === 'study' && !timerOpen(block))
      // Read the device again: a timer session may exist before its first load has finished.
      return loadStudyRun(block.id).then((run): unknown =>
        run ? openRecord(block, kind) : toggle(block),
      );
    if (block.status === 'planned' && kind) return void openRecord(block, kind);
    // Undo on a finished workout reopens its session with every logged set.
    if (block.status === 'done' && kind === 'workout')
      return change((s) => undoWorkout(s, date, block.id));
    return toggle(block);
  };
  const recordSub = (block: Block, kind: RecordKind | null): string | null => {
    if (block.status !== 'planned' || !kind) return null;
    const moved = block.movedFrom ? ` · moved from ${weekdayShort(block.movedFrom)}` : '';
    if (kind === 'weight') return `Record weight${moved}`;
    if (kind === 'money') return `Record balances${moved}`;
    if (kind === 'activity') return `Record activity and minutes${moved}`;
    if (kind === 'rules') return `Review your rules${moved}`;
    if (kind === 'trading') return `Open Trading · process review${moved}`;
    if (kind === 'study') {
      const recorded = studySessionFor(state, block.id)?.study;
      if (recorded)
        return fullStudy(recorded)
          ? `Study recorded · tap to mark done${moved}`
          : `${minutesLine(recorded)} recorded · still open${moved}`;
      const run = studyRuns[block.id];
      if (run) {
        const phase = phaseAt(run, now.getTime());
        const step = `stage ${Math.min(run.index + 1, run.stages.length)} of ${run.stages.length}`;
        return phase === 'review'
          ? `Every stage behind · confirm it${moved}`
          : `${phase === 'paused' ? 'Paused' : 'In progress'} · ${step}${moved}`;
      }
      const plan = studyPlanFor(state, block.routineId)!;
      return `${planMinutes(plan)} min target${plan.at !== null ? ` · ${displayTime(plan.at)}` : ''}${moved}`;
    }
    if (kind === 'circuit') {
      const circuit = circuitFor(state, block.routineId)!;
      return circuitSessionFor(state, block.id)
        ? circuitSessionFor(state, block.id)!.skipped.length
          ? `Circuit finished with ${circuitSessionFor(state, block.id)!.skipped.length} skipped · tap to review${moved}`
          : `Circuit recorded · tap to mark done${moved}`
        : `${activeCircuitLine(circuitRuns[block.id], circuit) ?? `${clockText(totalSeconds(circuit))} timed circuit`}${moved}`;
    }
    const session = sessionFor(state, block.id);
    if (session?.status === 'active' && doneSets(session) > 0) {
      const total = session.exercises.reduce((n, e) => n + e.sets.length, 0);
      return `In progress · ${doneSets(session)} of ${total} sets${moved}`;
    }
    const count = templateFor(state, block.routineId)?.exercises.length ?? 0;
    return `${count} exercise${count === 1 ? '' : 's'}${moved}`;
  };
  // A day that is over is never asked to schedule anything, whatever reason was stored with it.
  const needsTime = (block: Block) =>
    date < today ? 'No time set.' : (block.reason ?? 'Choose a time.');
  const entries = logFor(state, date);
  // A workout skipped on this day (its program rests by choice) keeps its place in the list as a
  // quiet row, with the workout that moved to the next training day.
  const rested = (date >= today ? restedByChoice(state, date) : []).flatMap((p) => {
    const routineId = nextWorkout(state, p, date);
    const title = p.routines.find((r) => r.id === routineId)?.title;
    return routineId && title ? [{ program: p, routineId, title }] : [];
  });
  // Other rotation programs resting on this day (today or later): one line says so.
  const resting =
    date >= today
      ? state.programs.filter(
          (p) =>
            p.rotation &&
            isRestDay(p, state.days[date], date) &&
            !rested.some((r) => r.program.id === p.id),
        )
      : [];
  // A later training day holds no rotation workout until it is the actual day: one line says
  // which is projected, as Week and the Tomorrow preview do. The day's count is left as saved.
  const projectedLines = projectedWorkouts(state, date, today);
  // One list in the order of the day: every routine's objective, study and trading included. Blocks
  // added by hand stay below it, as calendar commitments, under Schedule and Needs a time.
  const list = todayList(day.blocks, state.programs);
  // The rested rows sort into it at the workout's place; the list itself sorted once, as above.
  const shown = rested.length
    ? dayListOrder(
        [
          ...list.map((block) => ({ ...block, block, rested: null })),
          ...rested.map((r) => ({ routineId: r.routineId, start: null, block: null, rested: r })),
        ],
        state.programs,
      )
    : list.map((block) => ({ block, rested: null }));
  // The next thing to do takes the active tone: the first required objective still open.
  const nextUp = isToday ? nextOpen(list) : undefined;
  const timeline = scheduled.filter((b) => !b.routineId);
  const unplaced = overflow.filter((b) => !b.routineId);
  const canMove = (block: Block) =>
    block.status === 'planned' &&
    date >= today &&
    !!block.routineId &&
    !!routineOf(state, block.routineId)?.follows?.length;
  const moveCompanion = (block: Block) => {
    if (block.routineId) setCompanionMove({ date, routineId: block.routineId });
  };
  // Rows get one stable set of actions that call this render's handlers, so a memoized row is not
  // re-rendered only because the handlers were made again.
  const handlers = useRef<RowActions | null>(null);
  useLayoutEffect(() => {
    handlers.current = {
      check,
      edit: (block) => {
        const kind = kindOf(block);
        if (kind) openRecord(block, kind);
        else open(block);
      },
      // A rotation workout's Skip rests its program today, so the workout moves to the next
      // training day; anything else is excused for the day.
      skip: (block) => change((s) => skipObjective(s, date, block.id, new Date().toISOString())),
      move: moveCompanion,
    };
  });
  const actions = useMemo<RowActions>(
    () => ({
      check: (block) => handlers.current?.check(block),
      edit: (block) => handlers.current?.edit(block),
      skip: (block) => handlers.current?.skip(block),
      move: (block) => handlers.current?.move(block),
    }),
    [],
  );
  const checkLabel = (block: Block, kind: RecordKind | null) =>
    kind === 'study' && block.status === 'planned'
      ? timerOpen(block)
        ? `Open the timer in progress for ${block.title}`
        : actionLabel(block)
      : kind && block.status === 'planned'
        ? `${kind === 'workout' || kind === 'circuit' ? 'Start' : 'Record'} ${block.title}`
        : actionLabel(block);
  // The morning anchor's row reads its caption from the one anchor rule, and once ticked
  // today its details offer "I was up at…".
  const anchor = anchorRoutine(state);
  const isAnchor = (block: Block) => !!anchor && block.routineId === anchor.id;
  const morningLine = (block: Block) =>
    anchor && isAnchor(block) ? anchorCaption(state, anchor, date, today) : null;
  // While today's morning is open, its caption carries the count in Fern and the last seven
  // mornings as a trail.
  const morningCaption = (block: Block, text: string): ReactNode =>
    anchor &&
    isAnchor(block) &&
    isToday &&
    block.status === 'planned' &&
    /\d of the last/.test(text) ? (
      <MorningCaption text={text} trail={morningTrail(state, anchor, today)} />
    ) : undefined;
  const morningDetails = (block: Block) =>
    isAnchor(block) && isToday && block.status === 'done'
      ? { what: 'details', body: <MorningCorrection block={block} date={date} /> }
      : undefined;
  // The caption: a timed objective's time first, then its status, and a quiet Optional last.
  const caption = (block: Block, kind: RecordKind | null, sub: string | null, when?: string) =>
    [
      when,
      recordSub(block, kind) ?? morningLine(block) ?? evidenceNote(state, block, date) ?? sub,
      block.optional && 'Optional',
    ]
      .filter(Boolean)
      .join(' · ') || null;
  const row = (
    block: Block,
    sub: string | null,
    active = false,
    unscheduled = false,
    when?: string,
  ) => {
    const kind = kindOf(block);
    const text = caption(block, kind, sub, when);
    return (
      <TodayRow
        key={block.id}
        block={block}
        date={date}
        sub={text}
        caption={text ? morningCaption(block, text) : undefined}
        active={active}
        next={block === nextUp}
        editLabel={
          kind
            ? `Open ${block.title}`
            : unscheduled
              ? `Schedule ${block.title}`
              : `Edit ${block.title}`
        }
        checkLabel={checkLabel(block, kind)}
        // A plain checklist item ticks from anywhere on its row; anything that records something
        // (or a timed block) opens its screen.
        tickOnTap={!kind && !!block.checklist}
        steps={!!block.checklist}
        links={routineOf(state, block.routineId)?.links ?? NO_LINKS}
        canMove={canMove(block)}
        actions={actions}
        details={morningDetails(block)}
      />
    );
  };
  /** One objective of the list, at its place: study and an open trading day have their own rows. */
  const listRow = (block: Block) => {
    const kind = kindOf(block);
    if (kind === 'study')
      return (
        <StudyRow
          key={block.id}
          block={block}
          date={date}
          sub={caption(block, kind, recordedSub(block))}
          next={block === nextUp}
          checkLabel={checkLabel(block, kind)}
          canMove={canMove(block)}
          actions={actions}
          run={studyRuns[block.id]}
          onOpenTimer={() => setStudyTarget({ date, block })}
          onEditPlan={() => block.routineId && setStudyPlanOf(block.routineId)}
        />
      );
    if (trading && isTrading(block) && isToday && block.status === 'planned')
      return (
        <TradingRow
          key={block.id}
          book={trading}
          block={block}
          date={date}
          next={block === nextUp}
          checkLabel={checkLabel(block, kind)}
          canMove={canMove(block)}
          actions={actions}
        />
      );
    // A timed objective (not a checklist item) shows its time, or that it still needs one.
    const timed = !block.checklist && block.status === 'planned';
    if (timed && block.start === null) return row(block, needsTime(block), false, true);
    const current =
      timed &&
      isToday &&
      block.start! <= minute &&
      (block.duration == null || block.start! + block.duration > minute);
    return row(
      block,
      recordedSub(block),
      false,
      false,
      timed
        ? current
          ? `Now · ${timeRange(block)}`
          : `${timeRange(block)}${block.fixed ? ' · Fixed' : ''}`
        : undefined,
    );
  };
  // What the folded section holds, so it is clear what opening it shows.
  const moreTitle = isToday ? 'More for today' : 'More for this day';
  const priority = isToday ? currentPriority(state, today) : null;
  // Today's hero card holds the streak and the last seven days, so More holds them only on
  // another day.
  const moreSummary = [
    isToday && activeFocus(state) && 'focus',
    priority && 'money',
    isToday && 'tomorrow',
    'log',
    'plan',
  ]
    .filter(Boolean)
    .join(', ');
  const reminder = isToday ? backupReminder(state, now) : null;
  // The header is the title alone, so the list starts high; the date is read with the title and
  // shown in More. Until saved data loads, the static web render and the first client one match.
  const longDate = dateObject(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  // Today's sunrise behind the greeting: decoration only, never under small text.
  const sunrise = useWash(
    (c) =>
      `radial-gradient(ellipse at 15% 0%, ${c.washWarm} 0%, ${c.washRose} 28%, ${c.canvas} 70%)`,
    'canvas',
  );
  return (
    <Page
      // Until saved data loads the title is Today, so the static web render matches every visitor.
      title={!ready ? 'Today' : isToday ? greeting(now) : displayDate(date)}
      titleLabel={!ready ? undefined : isToday ? `Today, ${longDate}` : longDate}
      wash={ready && isToday ? sunrise : undefined}
      fit
      top={
        isToday ? (
          // The date over the greeting; VoiceOver reads it with the title.
          <Text
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no"
            maxFontSizeMultiplier={1.3}
            style={{ ...type.callout, color: palette.label2 }}>
            {longDate}
          </Text>
        ) : (
          <View style={{ alignItems: 'flex-start' }}>
            <LinkButton
              title="‹ Back to today"
              label="Back to today"
              tone="dim"
              onPress={() => setDate(localDate(now))}
            />
          </View>
        )
      }
      // The thin bar shows only once the board has scrolled away, so it never repeats it.
      pinned={
        boardAway && progress.total > 0 ? (
          <PinnedProgress done={progress.done} total={progress.total} cleared={progress.cleared} />
        ) : undefined
      }
      onScroll={(y) => setBoardAway(y > boardEnd.current)}
      hideError={editing !== null || restore.pending !== null}>
      {restore.steps && <RestoreDone steps={restore.steps} close={restore.dismiss} />}
      {/* With no programs and nothing saved, the setup card below explains the blank day. */}
      {(state.programs.length > 0 || outcome !== 'absent') &&
        !(preparing && outcome === 'absent') && (
          <View
            onLayout={(e) => {
              boardEnd.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height;
            }}>
            {isToday ? (
              <TodayHero
                progress={progress}
                streak={streak}
                week={week}
                outcome={outcome}
                protection={day.protection}
                hasActive={happening}
                celebrate={celebrated === date}
                onOpenStreak={() => setStreakOpen(true)}
              />
            ) : (
              <ObjectiveBoard
                isToday={isToday}
                notPast={date >= today}
                progress={progress}
                streak={streak}
                outcome={outcome}
                protection={day.protection}
                hasActive={happening}
                celebrate={celebrated === date}
                onOpenStreak={() => setStreakOpen(true)}
              />
            )}
          </View>
        )}
      {party && (
        <Celebration
          progress={progress}
          streak={streakStep(state, date, today)}
          week={week}
          moments={dayMoments(state, date, today).filter((m) => m.kind !== 'streak')}
          done={clearedTitles(day, list, state.programs)}
          dateLabel={longDate}
          close={() => setClosedParty(date)}
        />
      )}
      {/* A timer session from yesterday still open (it crossed midnight) stays reachable. */}
      {carried
        .filter((b) => studyRuns[b.id])
        .map((b) => (
          <CarriedStudyCard
            key={b.id}
            block={b}
            run={studyRuns[b.id]!}
            from={weekdayShort(yesterday)}
            onOpenTimer={() => setStudyTarget({ date: yesterday, block: b })}
          />
        ))}
      {/* Only once saved data has loaded: the static prerender never offers to replace it. */}
      {ready && !state.programs.length && (
        <View testID="welcome" style={[styles.card, { gap: 14, paddingTop: 22 }]}>
          <IconTile name="sunrise" tone="accent" size={52} />
          <View style={{ gap: 4 }}>
            <Text accessibilityRole="header" style={type.cardTitle}>
              Welcome to Life OS
            </Text>
            <Text style={styles.muted}>
              Restore your backup, start with your setup, or explore.
            </Text>
          </View>
          {restore.error && (
            <Text accessibilityRole="alert" style={styles.alert}>
              {restore.error}
            </Text>
          )}
          {/* Your own backup comes first; a setup and the fictional demo are the other choices. */}
          <View style={{ gap: 6 }}>
            <Button
              title="Restore my backup"
              onPress={() => void restore.choose()}
              disabled={restore.working}
            />
            <Text style={type.caption}>
              Opens Files: choose your latest Life OS backup and see what it holds before anything
              is replaced.
            </Text>
          </View>
          <View style={welcomeChoices}>
            <Row
              icon="doc"
              tone="sky"
              title="Load my setup"
              detail="Import a setup file in Settings"
              onPress={() => router.push('/settings')}
            />
            {blank && (
              <>
                <View style={welcomeLine} />
                <Row
                  icon="play"
                  tone="plum"
                  title="Explore demo"
                  detail="A fictional person's six weeks; your setup replaces it later"
                  onPress={() => void replaceAllState(() => demoState(today), change, sessionStore)}
                />
              </>
            )}
          </View>
        </View>
      )}
      <RestoreSheet restore={restore} />
      {/* A rest day is part of today's plan: one line says why no workout is listed, so the list
          still starts near the top. */}
      {resting.map((p) => {
        const next = nextWorkout(state, p, date);
        const title = p.routines.find((r) => r.id === next)?.title;
        return (
          <View
            key={p.id}
            testID="rest-day"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={[type.caption, { flex: 1, minWidth: 0 }]}>
              {p.title} · rest day · {title ? `${title} next` : 'nothing next'}
            </Text>
            {next && (
              <LinkButton
                title={date === today ? 'Train today' : 'Train this day'}
                label={`Train ${p.title} ${date === today ? 'today' : 'this day'} instead of resting`}
                onPress={() =>
                  void change((s) => trainDay(s, p.id, date, new Date().toISOString()))
                }
              />
            )}
          </View>
        );
      })}
      {projectedLines.map((w) => (
        <Text key={w.program.id} testID="projected-workout" style={type.caption}>
          {w.program.title} · {w.title}
          {w.companions.length ? ` + ${w.companions.join(', ')}` : ''} · projected, added on the day
        </Text>
      ))}
      {shown.length > 0 && (
        <RowList
          testID="today-list"
          items={shown.map(({ block, rested: r }) =>
            r
              ? {
                  key: `rested:${r.program.id}`,
                  framed: false,
                  node: (
                    <RestedWorkoutRow
                      title={r.title}
                      isToday={isToday}
                      onUndo={() =>
                        change((s) => trainDay(s, r.program.id, date, new Date().toISOString()))
                      }
                    />
                  ),
                }
              : {
                  key: block!.id,
                  // The next thing to do sits on the Ember tint (ObjectiveRow frames it).
                  framed: block === nextUp && block!.status === 'planned',
                  node: listRow(block!),
                },
          )}
        />
      )}
      {timeline.length > 0 && (
        <View style={styles.section}>
          <SectionLabel
            title="Schedule"
            count={`${timeline.filter((b) => b.status === 'done').length}/${timeline.length}`}
          />
          <RowList
            items={timeline.map((b) => {
              const current =
                isToday &&
                b.status === 'planned' &&
                b.start! <= minute &&
                (b.duration == null || b.start! + b.duration > minute);
              const sub =
                recordedSub(b) ??
                (current
                  ? `Now · ${timeRange(b)}`
                  : b === next
                    ? `Up next · ${timeRange(b)}`
                    : `${timeRange(b)}${b.fixed ? ' · Fixed' : ''}`);
              return { key: b.id, framed: current, node: row(b, sub, current) };
            })}
          />
        </View>
      )}
      {unplaced.length > 0 && (
        <View style={styles.section}>
          <SectionLabel title="Needs a time" count={String(unplaced.length)} />
          <RowList
            items={unplaced.map((b) => ({
              key: b.id,
              framed: false,
              node: row(
                b,
                b.status === 'done'
                  ? 'Completed without a scheduled time.'
                  : b.status === 'skipped'
                    ? 'Skipped without a scheduled time.'
                    : needsTime(b),
                false,
                true,
              ),
            }))}
          />
        </View>
      )}
      {/* Only today and later can be generated; an earlier day is left as it was recorded. */}
      {/* With nothing set up, the setup card above is the one next step. */}
      {state.programs.length > 0 &&
        date >= today &&
        !preparing &&
        !scheduled.length &&
        !checklist.length &&
        !overflow.length &&
        !resting.length &&
        !rested.length &&
        !projectedLines.length && (
          <Text style={styles.muted}>
            No objectives yet. Open {moreTitle} to plan the day or add a block: the day is yours.
          </Text>
        )}
      {reminder && (
        <LinkButton
          title={reminder}
          label={`${reminder} Open Backup and restore.`}
          tone="dim"
          onPress={() => router.push('/backup')}
        />
      )}
      {/* The list comes first; everything else waits here, one tap away. */}
      <Disclosure title={moreTitle} summary={moreSummary}>
        <View style={{ gap: 16 }}>
          {/* The date the header leaves out, other days, and the Day Clear streak's details. */}
          <View style={[styles.spread, { rowGap: 0 }]}>
            <DayNav
              date={date}
              isToday={isToday}
              onDate={setDate}
              onToday={() => setDate(localDate(now))}
            />
            {/* On today the hero card above holds the streak and opens its details. */}
            {!isToday && (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={streakDetailsLabel(streak)}
                onPress={() => setStreakOpen(true)}
                style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text
                  style={{
                    ...type.meta,
                    color: streak.current > 0 ? palette.label : palette.label3,
                  }}>
                  {streakLine(streak)}
                </Text>
              </PressableScale>
            )}
          </View>
          {isToday && (
            <TodayFocus
              today={today}
              canOpen={(b) => !!kindOf(b) && kindOf(b) !== 'study'}
              onOpen={(b) => openRecord(b, kindOf(b)!)}
            />
          )}
          {priority && <MoneyPriorityCard review={priority} />}
          {isToday && <TomorrowPreview now={now} />}
          {/* The log records what happened; it is not part of planning the day. */}
          <View style={styles.section}>
            <View style={styles.spread}>
              <SectionLabel
                title="Log"
                count={entries.length ? String(entries.length) : undefined}
              />
              <Button
                secondary
                small
                title="Add"
                label={isToday ? "Add to today's log" : "Add to this day's log"}
                onPress={() => setLogTarget({ date })}
              />
            </View>
            {entries.map((entry) => (
              <PressableScale
                key={entry.id}
                accessibilityRole="button"
                accessibilityLabel={`Edit log entry: ${entry.text}`}
                onPress={() => setLogTarget({ date, entry })}
                style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 6, gap: 2 }}>
                <Text style={styles.body} numberOfLines={3}>
                  {entry.text}
                </Text>
                <Text style={{ ...type.meta }}>
                  {doneAt(entry.at) ?? ''}
                  {entry.category ? ` · ${CATEGORY_LABELS[entry.category]}` : ''}
                </Text>
              </PressableScale>
            ))}
          </View>
          <View style={{ gap: 6, marginTop: 4 }}>
            <Text style={{ ...type.meta, color: palette.label2 }}>Plan this day</Text>
            <View style={[styles.row, { columnGap: 4 }]}>
              <Button secondary small title="Add block" onPress={() => open()} />
              {state.programs.length > 0 && (
                <Button
                  quiet
                  small
                  title="Change the order"
                  label="Change the order of the day"
                  onPress={() => setOrderOpen(true)}
                />
              )}
              {/* Generating or replanning a past day would rewrite recorded history. */}
              {date >= today && (
                <>
                  <Button
                    quiet
                    small
                    title="Generate day"
                    onPress={() =>
                      void change((s) =>
                        withDay(
                          s,
                          generateDay(
                            date,
                            s.settings,
                            s.programs,
                            s.days[date],
                            undefined,
                            planKeep(s, date),
                          ),
                        ),
                      )
                    }
                  />
                  <Button
                    quiet
                    small
                    title="Replan"
                    onPress={() =>
                      void change((s) =>
                        withDay(
                          s,
                          replanDay(
                            s.days[date] ?? day,
                            s.settings,
                            isToday ? minute : s.settings.wake,
                          ),
                        ),
                      )
                    }
                  />
                </>
              )}
            </View>
          </View>
        </View>
      </Disclosure>
      <Sheet
        title={
          !editing?.title
            ? 'Add a block'
            : editedRoutine
              ? (editingDate ?? date) === today
                ? 'Edit today only'
                : 'Edit this day only'
              : 'Edit block'
        }
        visible={editing !== null}
        close={() => setEditing(null)}>
        <Field label="Block name" value={title} onChange={setTitle} name />
        {!editing?.checklist && (
          <Field
            label="Start time (24-hour, blank = unscheduled)"
            value={time}
            onChange={setTime}
            placeholder="14:30"
            time
          />
        )}
        <Field label="Duration in minutes" value={duration} onChange={setDuration} numeric />
        {!editing?.checklist && (
          <Toggle
            title="Fixed time"
            detail={fixed ? 'Stays put during replanning' : 'Can move during replanning'}
            value={fixed}
            onChange={setFixed}
          />
        )}
        {editing?.steps.map((s, i) => (
          <Text key={i} style={styles.body}>
            • {s}
          </Text>
        ))}
        {formError && (
          <Text accessibilityRole="alert" style={styles.alert}>
            {formError}
          </Text>
        )}
        <Button title="Save block" onPress={() => void save()} />
        {editedRoutine && (
          <LinkButton
            title="Change days, privacy or pause ›"
            label={`Change days, privacy or pause for ${editing!.title} in Programs`}
            onPress={() => {
              setEditing(null);
              router.navigate({ pathname: '/programs', params: { routine: editedRoutine } });
            }}
          />
        )}
      </Sheet>
      <Sheet title="Day clear streak" visible={streakOpen} close={() => setStreakOpen(false)}>
        <StreakSheetBody
          streak={streak}
          protection={day.protection}
          // Only while the sheet is open: a closed sheet renders nothing.
          history={streakOpen ? streakHistory(state, date, today) : []}
          onProtect={(reason) =>
            void change((s) =>
              withDay(s, protectDay(s.days[date] ?? { date, blocks: [], revisions: [] }, reason)),
            ).then((saved) => saved && setStreakOpen(false))
          }
          onClearProtection={() =>
            void change((s) =>
              withDay(s, clearDayProtection(s.days[date] ?? { date, blocks: [], revisions: [] })),
            ).then((saved) => saved && setStreakOpen(false))
          }
        />
      </Sheet>
      <WorkoutSheet
        target={workoutTarget}
        close={() => setWorkoutTarget(null)}
        onShift={(mode) => {
          const target = workoutTarget;
          setWorkoutTarget(null);
          if (target?.block.routineId)
            setShiftTarget({ date: target.date, routineId: target.block.routineId, mode });
        }}
        onEditTime={() => {
          const target = workoutTarget;
          setWorkoutTarget(null);
          if (target) open(target.block, target.date);
        }}
      />
      <WeightSheet target={weightTarget} close={() => setWeightTarget(null)} />
      <MoneySheet target={moneyTarget} close={() => setMoneyTarget(null)} />
      <ActivitySheet target={activityTarget} close={() => setActivityTarget(null)} />
      <RulesSheet target={rulesTarget} close={() => setRulesTarget(null)} />
      <LogSheet target={logTarget} close={() => setLogTarget(null)} />
      <ShiftSheet target={shiftTarget} close={() => setShiftTarget(null)} />
      <CompanionMoveSheet target={companionMove} close={() => setCompanionMove(null)} />
      <StudyPlanEditor routineId={studyPlanOf} close={() => setStudyPlanOf(null)} />
      <DayOrderSheet visible={orderOpen} close={() => setOrderOpen(false)} />
      <StudySession
        target={studyTarget}
        close={() => {
          setStudyTarget(null);
          setStudyVersion((n) => n + 1);
        }}
      />
      <CircuitTimer
        target={circuitTarget}
        close={() => {
          setCircuitTarget(null);
          setCircuitVersion((n) => n + 1);
        }}
        onMove={() => {
          const target = circuitTarget;
          setCircuitTarget(null);
          setCircuitVersion((n) => n + 1);
          if (target?.block.routineId)
            setCompanionMove({ date: target.date, routineId: target.block.routineId });
        }}
      />
    </Page>
  );
}

/** The empty Today's other two choices, as one inset list inside the welcome card. */
const welcomeChoices = {
  marginHorizontal: -6,
  borderRadius: 18,
  backgroundColor: palette.canvas,
  overflow: 'hidden',
} as const;

const welcomeLine = {
  height: StyleSheet.hairlineWidth,
  backgroundColor: palette.separator,
  marginLeft: 64,
};
