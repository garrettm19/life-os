import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { FullScreen, ScreenHeader } from './full-screen';
import { useKeepAwake } from 'expo-keep-awake';
import { loadActiveCircuit, saveActiveCircuit } from '../data/timer-store';
import {
  Cue,
  allSkipped,
  checkpoint,
  circuitFor,
  circuitSessionFor,
  clockText,
  completeCircuit,
  cuesBetween,
  discardCircuitSession,
  elapsedAt,
  interrupted,
  jumpNext,
  jumpPrevious,
  markCircuitDone,
  nextFinishes,
  pauseAt,
  pauseRun,
  positionAt,
  readyRun,
  restoreRun,
  resumeRun,
  segmentsOf,
  startRun,
  tick,
  TimerRun,
  totalSeconds,
} from '../domain/intervals';
import { Block, CueMode, IntervalRoutine, displayDate } from '../domain/model';
import { setStatus } from '../domain/planner';
import { routineOf } from '../domain/workouts';
import { withDay } from '../domain/data';
import { useApp } from '../state/app-state';
import { clockFontSize, clockLineHeight } from './clock-size';
import { Button, Chip, styles } from './components';
import { CircuitEditor } from './circuit-editor';
import { useCues } from './cues';
import { PressableScale } from './motion';
import { fonts, glows, palette, radius, type } from './theme';

export type CircuitTarget = { date: string; block: Block };

/** The full-screen interval timer for one circuit objective. */
export function CircuitTimer({
  target,
  close,
  onMove,
}: {
  target: CircuitTarget | null;
  close: () => void;
  onMove?: () => void;
}) {
  return target ? (
    <TimerScreen key={target.block.id} target={target} close={close} onMove={onMove} />
  ) : null;
}

const CUE_MODES: [CueMode, string][] = [
  ['voice', 'Voice'],
  ['beep', 'Beeps'],
  ['mute', 'Mute'],
];

/** Keeps the screen awake while mounted: only while a circuit is running or paused. */
function KeepAwake() {
  useKeepAwake('life-os-circuit', { suppressDeactivateWarnings: true });
  return null;
}

function TimerScreen({
  target,
  close,
  onMove,
}: {
  target: CircuitTarget;
  close: () => void;
  onMove?: () => void;
}) {
  const { state } = useApp();
  const block =
    state.days[target.date]?.blocks.find((b) => b.id === target.block.id) ?? target.block;
  const circuit = circuitFor(state, block.routineId);
  const recorded = circuitSessionFor(state, block.id);
  const [editing, setEditing] = useState(false);
  // Cues live here, above the run, so the final "complete" cue is not cut off when the finished
  // run gives way to the recorded summary.
  const play = useCues(state.settings.timerCue ?? 'voice');
  return (
    <FullScreen
      close={close}
      overlay={
        circuit && (
          <CircuitEditor circuit={editing ? circuit : null} close={() => setEditing(false)} />
        )
      }>
      {!circuit ? (
        <Missing title={block.title} close={close} />
      ) : recorded ? (
        <Recorded
          circuit={circuit}
          date={target.date}
          block={block}
          finishedAt={recorded.finishedAt}
          skipped={recorded.skipped}
          close={close}
        />
      ) : (
        <Runner
          circuit={circuit}
          date={target.date}
          block={block}
          close={close}
          onEdit={() => setEditing(true)}
          onMove={onMove}
          play={play}
        />
      )}
    </FullScreen>
  );
}

function Header({ title, sub, close }: { title: string; sub: string; close: () => void }) {
  return <ScreenHeader title={title} sub={sub} close={close} closeLabel="Close the timer" />;
}

function Missing({ title, close }: { title: string; close: () => void }) {
  return (
    <View style={{ gap: 16 }}>
      <Header title={title} sub="Timed circuit" close={close} />
      <Text style={[styles.body, { paddingHorizontal: 20 }]}>
        This objective has no timed circuit anymore. Add one in Programs.
      </Text>
    </View>
  );
}

function Recorded({
  circuit,
  date,
  block,
  finishedAt,
  skipped,
  close,
}: {
  circuit: IntervalRoutine;
  date: string;
  block: Block;
  finishedAt: string;
  skipped: string[];
  close: () => void;
}) {
  const { change } = useApp();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Once a circuit is recorded, no saved run for this objective may linger to be recorded again.
  useEffect(() => {
    void saveActiveCircuit(block.id, null).catch(() => {});
  }, [block.id]);
  const at = new Date(finishedAt).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <View style={{ flex: 1, gap: 12 }}>
      <Header title={circuit.title} sub={displayDate(date)} close={close} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 24 }}>
        <Text
          accessibilityRole="alert"
          style={{
            ...type.callout,
            fontSize: 16,
            color: skipped.length ? palette.label : palette.done,
          }}>
          {skipped.length ? 'Circuit finished with skips' : 'Circuit complete'}
        </Text>
        <Text style={styles.body}>
          Finished at {at}.{' '}
          {skipped.length
            ? `Skipped: ${skipped.join(', ')}. Recorded as you did it, not as the full circuit.`
            : 'Every interval was run to its end.'}
        </Text>
        {block.status !== 'done' && (
          <Button
            title={skipped.length ? 'Count it as done' : 'Mark done'}
            label={`Mark ${block.title} done from the recorded circuit`}
            onPress={() =>
              void change((s) => markCircuitDone(s, date, block.id, new Date().toISOString())).then(
                (ok) => ok && close(),
              )
            }
          />
        )}
        {confirmDiscard ? (
          <View style={[styles.card, { gap: 10, borderColor: palette.danger }]}>
            <Text style={styles.body}>
              Remove this recorded circuit? The objective goes back to not done.
            </Text>
            <View style={styles.row}>
              <Button
                secondary
                small
                title="Remove circuit"
                onPress={() =>
                  void saveActiveCircuit(block.id, null)
                    .catch(() => {})
                    .then(() => change((s) => discardCircuitSession(s, date, block.id)))
                    .then((ok) => ok && setConfirmDiscard(false))
                }
              />
              <Button small title="Keep it" onPress={() => setConfirmDiscard(false)} />
            </View>
          </View>
        ) : (
          <Button
            secondary
            small
            title="Recorded by mistake?"
            label="Remove this recorded circuit"
            onPress={() => setConfirmDiscard(true)}
          />
        )}
      </ScrollView>
    </View>
  );
}

function Runner({
  circuit,
  date,
  block,
  close,
  onEdit,
  onMove,
  play,
}: {
  circuit: IntervalRoutine;
  date: string;
  block: Block;
  close: () => void;
  onEdit: () => void;
  onMove?: () => void;
  play: (cue: Cue) => void;
}) {
  const { state, busy, change } = useApp();
  const mode = state.settings.timerCue ?? 'voice';
  const [run, setRun] = useState<TimerRun>(readyRun);
  const [now, setNow] = useState(() => Date.now());
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'end' | 'finish' | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  /** The width the countdown has to fit in, measured once the screen lays out. */
  const windowWidth = useWindowDimensions().width;
  const [clockWidth, setClockWidth] = useState(0);
  /** Whether a saved run for this objective has been checked; Start waits for it. */
  const [checked, setChecked] = useState(false);
  const runRef = useRef(run);
  /** Elapsed time and wall clock at the last reading, for cues and the interruption guard. */
  const last = useRef(0);
  const lastWall = useRef(0);
  const owns = useRef(false);
  const attempted = useRef(false);
  const segments = segmentsOf(circuit);
  const total = totalSeconds(circuit);

  /** Every change to the run goes through here, so the saved copy never lags what is shown. */
  const update = useCallback(
    (next: TimerRun) => {
      runRef.current = next;
      setRun(next);
      if (next.status === 'ready') {
        if (owns.current) void saveActiveCircuit(block.id, null).catch(() => {});
        owns.current = false;
        return;
      }
      owns.current = true;
      void saveActiveCircuit(block.id, {
        intervalId: circuit.id,
        planVersion: circuit.updatedAt,
        date,
        blockId: block.id,
        run: checkpoint(next, Date.now()),
      }).catch(() => {});
    },
    [circuit.id, circuit.updatedAt, date, block.id],
  );

  // A circuit left in progress (closed, interrupted or the app quit) comes back paused where it
  // was, unless the circuit was edited since: a run is never applied to a different plan.
  useEffect(() => {
    let live = true;
    void loadActiveCircuit(block.id).then((saved) => {
      if (live) setChecked(true);
      if (!live || !saved || runRef.current.status !== 'ready') return;
      // An objective already done another way never resumes a run (a skipped one still can).
      if (block.status === 'done') {
        void saveActiveCircuit(block.id, null).catch(() => {});
        return;
      }
      if (saved.intervalId !== circuit.id || saved.planVersion !== circuit.updatedAt) {
        void saveActiveCircuit(block.id, null).catch(() => {});
        setNote('The circuit changed since it was paused, so it starts over.');
        return;
      }
      const restored = restoreRun(saved.run, Date.now());
      // A run that had already finished is offered for saving, never recorded on its own: the
      // user may have removed that recording on purpose since.
      if (restored.status === 'finished') {
        attempted.current = true;
        setSaveFailed(true);
      }
      owns.current = true;
      runRef.current = restored;
      last.current = elapsedAt(restored, Date.now());
      setRun(restored);
      if (restored.status === 'paused')
        setNote(`Paused at ${clockText(restored.elapsedMs / 1000)}. Resume when you are ready.`);
    });
    return () => {
      live = false;
    };
    // Read once per opened objective; a later status change is handled by the recorded view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, circuit.id, circuit.updatedAt]);

  // The clock: everything shown is derived from elapsed time, so a late tick never drifts.
  useEffect(() => {
    if (run.status !== 'running') return;
    lastWall.current = Date.now();
    const timer = setInterval(() => {
      const t = Date.now();
      const current = runRef.current;
      // Suspended, or the clock jumped: pause where it was last seen instead of skipping ahead.
      if (interrupted(lastWall.current, t)) {
        update(pauseAt(current, last.current));
        setNote('Paused: the timer was interrupted. Resume when you are ready.');
        setNow(t);
        return;
      }
      lastWall.current = t;
      const elapsed = elapsedAt(current, t);
      for (const cue of cuesBetween(circuit, last.current, elapsed)) play(cue);
      const before = positionAt(circuit, last.current).index;
      last.current = elapsed;
      const ticked = tick(current, circuit, t);
      if (ticked !== current) update(ticked);
      // Save a checkpoint at each new interval, so a closed app loses at most one interval.
      else if (positionAt(circuit, elapsed).index !== before) update(current);
      setNow(t);
    }, 200);
    return () => clearInterval(timer);
  }, [run.status, circuit, play, update]);

  // Leaving the app pauses the circuit rather than pretending it kept time while suspended.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'background' && runRef.current.status === 'running') {
        const paused = pauseRun(runRef.current, Date.now());
        last.current = paused.elapsedMs;
        update(paused);
        setNote('Paused while Life OS was in the background.');
      }
    });
    return () => subscription.remove();
  }, [update]);

  // Closing the timer (or the screen unmounting) pauses a running circuit; it is never completed.
  useEffect(
    () => () => {
      if (runRef.current.status === 'running') update(pauseRun(runRef.current, Date.now()));
    },
    [update],
  );

  const everySkipped = run.status === 'finished' && allSkipped(circuit, run.skipped);
  /** Saves a finished run once; a failure waits for the user's retry instead of looping. */
  const record = useCallback(
    async (finished: TimerRun) => {
      const finishedAt = finished.endedAt ?? new Date().toISOString();
      const ok = await change((s) =>
        completeCircuit(s, {
          intervalId: circuit.id,
          date,
          blockId: block.id,
          startedAt: finished.startedAt ?? finishedAt,
          finishedAt,
          skipped: finished.skipped,
        }),
      );
      setSaveFailed(!ok);
      if (ok) {
        owns.current = false;
        void saveActiveCircuit(block.id, null).catch(() => {});
      }
    },
    [change, circuit.id, date, block.id],
  );
  useEffect(() => {
    if (run.status !== 'finished') {
      attempted.current = false;
      return;
    }
    if (attempted.current || allSkipped(circuit, runRef.current.skipped)) return;
    attempted.current = true;
    void record(runRef.current);
  }, [run.status, circuit, record]);

  const elapsed = elapsedAt(run, now);
  const at = positionAt(circuit, elapsed);
  const act = (next: (r: TimerRun, t: number) => TimerRun, jumped = false) => {
    const t = Date.now();
    const before = runRef.current;
    const result = next(before, t);
    if (result === before) return;
    const landed = elapsedAt(result, t);
    if (before.status === 'ready') for (const cue of cuesBetween(circuit, -1, landed)) play(cue);
    else if (jumped) for (const cue of cuesBetween(circuit, last.current, landed, true)) play(cue);
    last.current = landed;
    lastWall.current = t;
    setNote(null);
    setConfirm(null);
    setNow(t);
    update(result);
  };
  const next = () => {
    if (nextFinishes(runRef.current, circuit, Date.now())) setConfirm('finish');
    else act((r, t) => jumpNext(r, circuit, t), true);
  };
  const setMode = (value: CueMode) =>
    void change((s) => ({ ...s, settings: { ...s.settings, timerCue: value } }));
  const modes = (
    <View accessibilityRole="radiogroup" accessibilityLabel="Timer sound" style={styles.row}>
      {CUE_MODES.map(([value, title]) => (
        <Chip
          key={value}
          role="radio"
          title={title}
          on={mode === value}
          onPress={() => setMode(value)}
        />
      ))}
    </View>
  );

  if (run.status === 'ready')
    return (
      <View style={{ flex: 1, gap: 12 }}>
        <Header title={circuit.title} sub={displayDate(date)} close={close} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ ...type.count, fontSize: 44, lineHeight: 50 }}>
              {clockText(total)}
            </Text>
            <Text style={styles.label}>
              {circuit.steps.length} intervals
              {circuit.prepSeconds ? ` · ${circuit.prepSeconds} s to get ready` : ''}
            </Text>
          </View>
          {note && <Text style={styles.muted}>{note}</Text>}
          <Button
            title="Start circuit"
            label="Start the timer"
            disabled={!checked}
            onPress={() => act(startRun)}
          />
          <Text style={styles.label}>Sound · plays over your music</Text>
          {modes}
          <View style={[styles.card, { gap: 2 }]}>
            {circuit.steps.map((step, i) => (
              <View key={step.id} style={[styles.spread, { minHeight: 32, flexWrap: 'nowrap' }]}>
                <Text style={[styles.body, { flex: 1 }]}>
                  <Text style={{ ...fonts.figure, color: palette.label3 }}>{i + 1} </Text>
                  {step.name}
                </Text>
                <Text style={{ ...type.meta, color: palette.label2 }}>
                  {clockText(step.seconds)}
                  {i < circuit.steps.length - 1 && step.restAfter
                    ? ` · rest ${clockText(step.restAfter)}`
                    : ''}
                </Text>
              </View>
            ))}
          </View>
          <Button secondary small title="Edit circuit" onPress={onEdit} />
          {onMove &&
            block.status === 'planned' &&
            !!routineOf(state, block.routineId)?.follows?.length && (
              <Button
                secondary
                small
                title="Move to another day"
                label={`Move ${block.title} to another day`}
                onPress={onMove}
              />
            )}
          {block.status === 'planned' && (
            <Button
              secondary
              small
              title="Done without the timer"
              label={`Mark ${block.title} done without running the timer`}
              onPress={() =>
                void change((s) =>
                  withDay(s, setStatus(s.days[date], block.id, 'done', new Date().toISOString())),
                ).then((ok) => ok && close())
              }
            />
          )}
        </ScrollView>
      </View>
    );

  if (run.status === 'finished')
    return (
      <View style={{ flex: 1, gap: 20 }}>
        <Header title={circuit.title} sub={displayDate(date)} close={close} />
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          {everySkipped ? (
            <>
              <Text accessibilityRole="alert" style={styles.body}>
                Every interval was skipped, so this circuit is not recorded.
              </Text>
              <Button
                secondary
                title="Back to the start"
                onPress={() => {
                  last.current = 0;
                  update(readyRun());
                }}
              />
            </>
          ) : (
            <>
              <Text
                accessibilityRole="alert"
                style={{
                  ...type.callout,
                  fontSize: 18,
                  lineHeight: 24,
                  color: run.skipped.length ? palette.label : palette.done,
                }}>
                {run.skipped.length ? 'Circuit finished with skips' : 'Circuit complete'}
              </Text>
              <Text style={styles.body}>
                {run.skipped.length
                  ? `Skipped: ${run.skipped.join(', ')}.`
                  : `All ${circuit.steps.length} intervals, ${clockText(total)}.`}
              </Text>
              {run.skipped.length > 0 && !saveFailed && (
                <Text style={styles.muted}>
                  Recorded as you did it. The objective stays open; count it as done if you choose.
                </Text>
              )}
              {saveFailed ? (
                <>
                  <Text accessibilityRole="alert" style={styles.alert}>
                    The circuit is finished but could not be saved yet.
                  </Text>
                  <Button
                    title="Save circuit"
                    disabled={busy}
                    onPress={() => void record(runRef.current)}
                  />
                </>
              ) : (
                <Text style={styles.muted}>Saving…</Text>
              )}
            </>
          )}
        </View>
      </View>
    );

  // During a rest or the countdown the screen already shows what comes next, so you can get set.
  const working = at.segment.kind === 'work';
  const kindLabel = working
    ? 'Work'
    : at.segment.kind === 'rest'
      ? 'Rest · up next'
      : 'Get ready · first up';
  const heading = working ? at.segment.label : (at.next?.label ?? at.segment.label);
  const after = segments[at.index + 2]?.label;
  const nextLine = !working
    ? null
    : !at.next
      ? 'Last interval'
      : at.next.kind === 'rest' && after
        ? `Next · Rest, then ${after}`
        : `Next · ${at.next.label}`;
  const accent = working ? palette.accent : palette.label2;
  const workIndex = segments.slice(0, at.index + 1).filter((x) => x.kind === 'work').length;
  const seconds = Math.ceil(at.remainingMs / 1000);
  const paused = run.status === 'paused';
  const fraction = Math.min(1, elapsed / (total * 1000));
  const clock = clockText(seconds);
  const clockSize = clockFontSize(clockWidth || windowWidth - 40, clock);
  return (
    <View style={{ flex: 1 }}>
      <KeepAwake />
      <Header
        title={circuit.title}
        sub={`${clockText(total - elapsed / 1000)} left · ${workIndex}/${circuit.steps.length}`}
        close={close}
      />
      <View
        style={{
          height: 3,
          marginHorizontal: 20,
          marginTop: 10,
          backgroundColor: palette.fillStrong,
        }}>
        <View
          style={{
            height: 3,
            backgroundColor: palette.done,
            transformOrigin: 'left',
            transform: [{ scaleX: fraction }],
          }}
        />
      </View>
      {/* Scrolls only when large text or a small screen needs it; the controls stay reachable. */}
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-between', paddingTop: 8 }}>
        <View
          onLayout={(e) => setClockWidth(e.nativeEvent.layout.width - 40)}
          style={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, gap: 6 }}>
          <Text maxFontSizeMultiplier={1.5} style={{ ...type.meta, fontSize: 14, color: accent }}>
            {paused ? `Paused · ${kindLabel}` : kindLabel}
          </Text>
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1.3}
            style={{
              ...fonts.bold,
              fontSize: 38,
              lineHeight: 44,
              color: working ? palette.label : palette.label2,
            }}>
            {heading}
          </Text>
          <Text
            accessibilityLabel={`${seconds} seconds left${paused ? ', paused' : ''}`}
            maxFontSizeMultiplier={1}
            numberOfLines={1}
            style={{
              ...fonts.figure,
              fontSize: clockSize,
              lineHeight: clockLineHeight(clockSize),
              color: paused ? palette.label2 : accent,
              fontVariant: ['tabular-nums'],
            }}>
            {clock}
          </Text>
          {nextLine && (
            <Text
              maxFontSizeMultiplier={1.5}
              style={{ ...type.meta, fontSize: 13 }}
              numberOfLines={2}>
              {nextLine}
            </Text>
          )}
          {note && <Text style={styles.muted}>{note}</Text>}
        </View>
        <View style={{ paddingHorizontal: 20, paddingBottom: 16, paddingTop: 12, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <RoundButton
              title="Prev"
              label="Previous interval"
              onPress={() => act((r, t) => jumpPrevious(r, circuit, t), true)}
            />
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={paused ? 'Resume' : 'Pause'}
              onPress={() => act(paused ? resumeRun : pauseRun)}
              containerStyle={{ flex: 1 }}
              style={[
                {
                  minHeight: 72,
                  borderRadius: radius.card,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: paused ? palette.done : palette.accentTint,
                  borderWidth: 1,
                  borderColor: paused ? palette.done : palette.accentEdge,
                },
                !paused && glows.active,
              ]}>
              <Text
                maxFontSizeMultiplier={1.3}
                style={{
                  ...fonts.bold,
                  fontSize: 20,
                  color: paused ? palette.onDone : palette.label,
                }}>
                {paused ? 'Resume' : 'Pause'}
              </Text>
            </PressableScale>
            <RoundButton title="Next" label="Next interval" onPress={next} />
          </View>
          {modes}
          {confirm === 'finish' ? (
            <View style={[styles.card, { gap: 10 }]}>
              <Text style={styles.body}>
                This is the last interval. Finish the circuit now and record it?
              </Text>
              <View style={styles.row}>
                <Button
                  small
                  title="Finish and record"
                  onPress={() => act((r, t) => jumpNext(r, circuit, t), true)}
                />
                <Button secondary small title="Keep going" onPress={() => setConfirm(null)} />
              </View>
            </View>
          ) : confirm === 'end' ? (
            <View style={[styles.card, { gap: 10, borderColor: palette.danger }]}>
              <Text style={styles.body}>End now? An unfinished circuit is not recorded.</Text>
              <View style={styles.row}>
                <Button
                  secondary
                  small
                  title="End circuit"
                  onPress={() => {
                    setConfirm(null);
                    last.current = 0;
                    update(readyRun());
                  }}
                />
                <Button small title="Keep going" onPress={() => setConfirm(null)} />
              </View>
            </View>
          ) : (
            <Button
              secondary
              small
              title="End"
              label="End the circuit"
              onPress={() => setConfirm('end')}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function RoundButton({
  title,
  label,
  onPress,
}: {
  title: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minWidth: 72,
        minHeight: 72,
        paddingHorizontal: 8,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: palette.edge,
        backgroundColor: palette.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text
        maxFontSizeMultiplier={1.3}
        style={{
          ...fonts.semibold,
          fontSize: 14,
          color: palette.label,
        }}>
        {title}
      </Text>
    </PressableScale>
  );
}
