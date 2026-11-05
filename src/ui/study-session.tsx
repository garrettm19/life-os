import { useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Text, View } from 'react-native';
import { FullScreen, ScreenHeader } from './full-screen';
import { loadStudyRun, saveStudyRun } from '../data/study-store';
import { setStageAlert } from '../data/notifier';
import { stageAlert } from '../domain/reminders';
import { routineOf } from '../domain/workouts';
import { withDay } from '../domain/data';
import { clockText } from '../domain/intervals';
import { Block, displayDate, displayTime, localDate } from '../domain/model';
import { setStatus } from '../domain/planner';
import {
  StudyRun,
  advanceStudy,
  backToLastStage,
  discardStudySession,
  fullStudy,
  markStudyDone,
  minutesLine,
  pauseStudy,
  phaseAt,
  planMinutes,
  recordStudy,
  resumeStudy,
  runTotals,
  stageSpentMs,
  startStudy,
  studyPlanFor,
  studySessionFor,
  restoreStudyRun,
  toRecord,
} from '../domain/study';
import { useApp } from '../state/app-state';
import { announce } from './announce';
import { Button, styles } from './components';
import { newId } from './ids';
import { StudyPlanEditor } from './study-plan-editor';
import { PressableScale } from './motion';
import {
  StageBar,
  StageLinks,
  StageList,
  planStages,
  recordStages,
  runStages,
} from './study-parts';
import { fonts, glows, palette, radius, type } from './theme';

export type StudyTarget = { date: string; block: Block };

/** The focused study session for one study objective: stages, clock, review and confirmation. */
export function StudySession({ target, close }: { target: StudyTarget | null; close: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (!target) return null;
  return (
    <FullScreen
      close={close}
      // Inside this modal, so it can present above the full-screen session on iOS.
      overlay={<StudyPlanEditor routineId={editing} close={() => setEditing(null)} />}>
      <StudyScreen key={target.block.id} target={target} close={close} onEditPlan={setEditing} />
    </FullScreen>
  );
}

/** How long after a tap a second one on the same spot is read as the same double tap. */
const DOUBLE_TAP_MS = 700;

function Header({ title, sub, close }: { title: string; sub: string; close: () => void }) {
  return (
    <ScreenHeader title={title} sub={sub} close={close} closeLabel="Close the study session" />
  );
}

function StudyScreen({
  target,
  close,
  onEditPlan,
}: {
  target: StudyTarget;
  close: () => void;
  onEditPlan: (routineId: string) => void;
}) {
  const { state, error } = useApp();
  const { date } = target;
  const block = state.days[date]?.blocks.find((b) => b.id === target.block.id) ?? target.block;
  const plan = studyPlanFor(state, block.routineId);
  const recorded = studySessionFor(state, block.id);
  const sub = `${displayDate(date)} · Study`;
  // The page behind this full-screen session cannot be seen, so a refused save is shown here.
  const alert = error ? (
    <Text accessibilityRole="alert" style={[styles.alert, { paddingHorizontal: 20 }]}>
      {error}
    </Text>
  ) : null;
  if (recorded?.study)
    return (
      <View style={{ flex: 1, gap: 12 }}>
        <Header title={block.title} sub={sub} close={close} />
        {alert}
        <Recorded date={date} block={block} close={close} />
      </View>
    );
  if (!plan) return <NotStudy title={block.title} sub={sub} blockId={block.id} close={close} />;
  return (
    <View style={{ flex: 1, gap: 12 }}>
      <Header title={block.title} sub={sub} close={close} />
      {alert}
      <Runner date={date} block={block} close={close} onEditPlan={onEditPlan} />
    </View>
  );
}

/** The objective stopped being a study; a run saved for it can never be recorded, so it goes. */
function NotStudy({
  title,
  sub,
  blockId,
  close,
}: {
  title: string;
  sub: string;
  blockId: string;
  close: () => void;
}) {
  useEffect(() => {
    void saveStudyRun(blockId, null).catch(() => {});
    void setStageAlert(blockId, null).catch(() => {});
  }, [blockId]);
  return (
    <View style={{ gap: 16 }}>
      <Header title={title} sub={sub} close={close} />
      <Text style={[styles.body, { paddingHorizontal: 20 }]}>
        This objective is no longer a study session. Set one up in Programs.
      </Text>
    </View>
  );
}

function Runner({
  date,
  block,
  close,
  onEditPlan,
}: {
  date: string;
  block: Block;
  close: () => void;
  onEditPlan: (routineId: string) => void;
}) {
  const { state, change, busy } = useApp();
  const plan = studyPlanFor(state, block.routineId)!;
  const [run, setRun] = useState<StudyRun | null>(null);
  const [checked, setChecked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [confirm, setConfirm] = useState<'early' | 'end' | 'discard' | null>(null);
  const [storeFailed, setStoreFailed] = useState(false);
  const runRef = useRef<StudyRun | null>(null);

  /** Every change to the run is saved on the device at once, so leaving the app loses nothing. */
  const update = (next: StudyRun | null) => {
    runRef.current = next;
    setRun(next);
    setNow(Date.now());
    setConfirm(null);
    // The alert follows the running stage: scheduled while it runs, canceled otherwise. It is set
    // after the run is saved, so the alert cleanup never sees an alert without its run.
    const routine = routineOf(state, block.routineId);
    const alert = next ? stageAlert(next, routine, Date.now()) : null;
    void saveStudyRun(block.id, next)
      .then(() => setStoreFailed(false))
      .catch(() => setStoreFailed(true))
      .then(() => setStageAlert(block.id, alert))
      .catch(() => {});
  };

  // A session left in progress comes back exactly where it was (still running if it was running).
  useEffect(() => {
    let live = true;
    void loadStudyRun(block.id).then((saved) => {
      if (!live) return;
      setChecked(true);
      if (!saved || runRef.current) return;
      // An objective already completed another way never resumes an old run.
      if (block.status === 'done' || saved.routineId !== block.routineId) {
        void saveStudyRun(block.id, null).catch(() => {});
        return;
      }
      const restored = restoreStudyRun(saved, Date.now());
      runRef.current = restored;
      setRun(restored);
      setNow(Date.now());
    });
    return () => {
      live = false;
    };
    // Read once per opened objective.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  const phase = run ? phaseAt(run, now) : null;
  // The clock: what is shown is derived from wall-clock time, so a late tick never drifts.
  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') setNow(Date.now());
    });
    return () => subscription.remove();
  }, []);
  // Say so once when a stage reaches its time while this screen is open.
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (lastPhase.current === 'running' && phase === 'timeUp' && run)
      announce(`Time is up for ${run.stages[run.index].title}.`);
    lastPhase.current = phase;
  }, [phase, run]);

  const act = (operation: (r: StudyRun, t: number) => StudyRun) => {
    const current = runRef.current;
    if (current) update(operation(current, Date.now()));
  };
  // Starting the session or the next stage puts the big Pause where the button just tapped was:
  // a press there right after is the same double tap, never a pause of what just started.
  const placeTaken = useRef(0);
  const takePlace = () => {
    placeTaken.current = Date.now();
  };
  const pauseOrResume = (operation: (r: StudyRun, t: number) => StudyRun) => {
    if (Date.now() - placeTaken.current < DOUBLE_TAP_MS) return;
    act(operation);
  };
  const saving = useRef(false);
  const record = async (countAsDone: boolean) => {
    const current = runRef.current;
    // One save at a time: a second tap in the same frame never tries to record again.
    if (!current || saving.current) return;
    saving.current = true;
    try {
      await save(current, countAsDone);
    } finally {
      saving.current = false;
    }
  };
  const save = async (current: StudyRun, countAsDone: boolean) => {
    const id = newId('study');
    const at = new Date().toISOString();
    const full = fullStudy(toRecord(current, Date.parse(at)));
    const ok = await change((s) => recordStudy(s, current, { countAsDone }, id, at));
    if (!ok) return;
    runRef.current = null;
    void saveStudyRun(block.id, null).catch(() => {});
    void setStageAlert(block.id, null).catch(() => {});
    // A completed objective goes straight back to Today, where its progress shows.
    if (full || countAsDone) close();
  };

  if (!run || !phase) {
    const minutes = planMinutes(plan);
    // A new session starts only on its objective's own day, so today's work is never credited to
    // another date. (A session already running keeps its day, even past midnight.)
    const ownDay = date === localDate(new Date(now));
    return (
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <Text maxFontSizeMultiplier={1.2} style={{ ...type.count, fontSize: 48, lineHeight: 54 }}>
            {clockText(minutes * 60)}
          </Text>
          <Text style={styles.label}>
            {plan.stages.length} stage{plan.stages.length === 1 ? '' : 's'}
            {plan.at !== null ? ` · planned ${displayTime(plan.at)}` : ''}
          </Text>
        </View>
        <StageBar stages={planStages(plan)} />
        <StageList stages={planStages(plan)} />
        <Button
          title="Start study"
          label="Start the study session"
          disabled={!checked || block.status === 'done' || !ownDay}
          onPress={() => {
            takePlace();
            update(
              startStudy(
                plan,
                { routineId: block.routineId!, date, blockId: block.id },
                Date.now(),
              ),
            );
          }}
        />
        {!ownDay && (
          <Text style={styles.muted}>
            A study session starts on its own day. For another day, mark it done without the timer
            if you studied.
          </Text>
        )}
        <Text style={styles.muted}>
          The clock keeps running while you work in other apps. Each stage stops at its time and
          waits for you; nothing is recorded until you confirm.
        </Text>
        <Button
          secondary
          small
          title="Edit plan, time and reminders"
          onPress={() => onEditPlan(block.routineId!)}
        />
        {block.status === 'planned' && (
          <Button
            secondary
            small
            title="Mark done without the timer"
            label={`Mark ${block.title} done without the timer`}
            onPress={() =>
              void change((s) =>
                withDay(s, setStatus(s.days[date], block.id, 'done', new Date().toISOString())),
              ).then((ok) => ok && close())
            }
          />
        )}
      </ScrollView>
    );
  }

  const stages = runStages(run, now);
  const totals = runTotals(run, now);
  if (phase === 'review') {
    const result = toRecord(run, now);
    const full = fullStudy(result);
    const last = run.stages[run.stages.length - 1];
    const lastShort = run.spentMs[run.stages.length - 1] < last.plannedSeconds * 1000;
    return (
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, gap: 16 }}>
        <Text
          accessibilityRole="header"
          style={{
            ...type.callout,
            fontSize: 16,
            lineHeight: 22,
            color: full ? palette.done : palette.label,
          }}>
          {full ? 'Every stage complete' : 'Session shorter than planned'}
        </Text>
        <Text style={{ ...type.count, color: full ? palette.done : palette.label }}>
          {minutesLine(result)}
        </Text>
        <StageBar stages={stages} />
        <StageList stages={stages} />
        {full ? (
          <>
            <Button
              title={`Confirm ${Math.floor(totals.planned / 60)}-minute study`}
              label={`Confirm the study session and complete ${block.title}`}
              disabled={busy}
              onPress={() => void record(false)}
            />
            <Text style={styles.muted}>
              Records each stage as timed and completes {block.title}.
            </Text>
          </>
        ) : (
          <>
            <Button
              title="Save session"
              label="Save the session and keep the objective open"
              disabled={busy}
              onPress={() => void record(false)}
            />
            <Text style={styles.muted}>
              Saved as {minutesLine(result)}; {block.title} stays open.
            </Text>
            <Text style={styles.muted}>
              Counted as done, it counts for Day Cleared. Progress shows it as a shorter session.
            </Text>
            <Button
              secondary
              title="Save and count as done"
              disabled={busy}
              onPress={() => void record(true)}
            />
            {lastShort && (
              <Button
                secondary
                small
                title={`Back to ${last.title}`}
                onPress={() => act(backToLastStage)}
              />
            )}
          </>
        )}
        <DiscardControl
          open={confirm === 'discard'}
          setOpen={(open) => setConfirm(open ? 'discard' : null)}
          onDiscard={() => update(null)}
        />
      </ScrollView>
    );
  }

  const stage = run.stages[run.index];
  const remaining = Math.max(0, stage.plannedSeconds - Math.floor(stageSpentMs(run, now) / 1000));
  const next = run.stages[run.index + 1];
  const paused = phase === 'paused';
  const up = phase === 'timeUp';
  const accent = up ? palette.done : paused ? palette.label2 : palette.accent;
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, gap: 16 }}>
      <StageBar stages={stages} />
      <View style={{ gap: 6 }}>
        <Text maxFontSizeMultiplier={1.5} style={{ ...type.meta, fontSize: 13, color: accent }}>
          Stage {run.index + 1} of {run.stages.length}
          {paused ? ' · paused' : up ? ' · time is up' : ''}
        </Text>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.3}
          style={{
            ...fonts.bold,
            fontSize: 28,
            lineHeight: 34,
            color: palette.label,
          }}>
          {stage.title}
        </Text>
        <Text
          accessibilityLabel={
            up
              ? `Time is up for ${stage.title}`
              : `${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds left${paused ? ', paused' : ''}`
          }
          maxFontSizeMultiplier={1}
          adjustsFontSizeToFit
          numberOfLines={1}
          style={{
            ...fonts.figure,
            fontSize: 96,
            lineHeight: 112,
            color: accent,
            fontVariant: ['tabular-nums'],
          }}>
          {clockText(remaining)}
        </Text>
        <Text style={{ ...type.meta }}>
          {Math.floor(totals.spent / 60)} of {Math.floor(totals.planned / 60)} min ·{' '}
          {next ? `next · ${next.title}` : 'last stage'}
        </Text>
      </View>
      <StageLinks links={stage.links} />
      {/* A confirmation holds the one primary action: a Fern Resume or Start waits for Keep going,
          while the Ember Pause stays. */}
      {confirm && (paused || up) ? null : up ? (
        <BigButton
          title={next ? `Start ${next.title}` : 'Review session'}
          label={next ? `Start stage ${run.index + 2}, ${next.title}` : 'Review the session'}
          tone="done"
          onPress={() => {
            takePlace();
            act(advanceStudy);
          }}
        />
      ) : (
        <BigButton
          title={paused ? 'Resume' : 'Pause'}
          label={paused ? `Resume ${stage.title}` : `Pause ${stage.title}`}
          tone={paused ? 'done' : 'now'}
          onPress={() => pauseOrResume(paused ? resumeStudy : pauseStudy)}
        />
      )}
      {storeFailed && (
        <Text accessibilityRole="alert" style={styles.alert}>
          Progress could not be saved on this device. Keep this screen open until you finish.
        </Text>
      )}
      {confirm === 'early' ? (
        <View style={[styles.card, { gap: 10 }]}>
          <Text style={styles.body}>
            Finish {stage.title} now, {clockText(remaining)} early? The session will be recorded as
            shorter than planned.
          </Text>
          <View style={styles.row}>
            <Button small title="Finish stage" onPress={() => act(advanceStudy)} />
            <Button secondary small title="Keep going" onPress={() => setConfirm(null)} />
          </View>
        </View>
      ) : confirm === 'end' ? (
        <View style={[styles.card, { gap: 10, borderColor: palette.danger }]}>
          <Text style={styles.body}>
            End the session at {minutesLine(toRecord(run, now))}?{' '}
            {paused
              ? 'Keep going leaves it paused for later.'
              : 'Pausing keeps it for later instead.'}
          </Text>
          <View style={styles.row}>
            <Button
              small
              title="Save what I did"
              label="End and save what was timed, keeping the objective open"
              disabled={busy}
              onPress={() => void record(false)}
            />
            <Button secondary small title="Discard" onPress={() => setConfirm('discard')} />
            <Button secondary small title="Keep going" onPress={() => setConfirm(null)} />
          </View>
        </View>
      ) : confirm === 'discard' ? (
        <DiscardControl
          open
          setOpen={(open) => setConfirm(open ? 'discard' : null)}
          onDiscard={() => update(null)}
        />
      ) : (
        <View style={styles.row}>
          {!up && (
            <Button
              secondary
              small
              title="Finish stage early"
              onPress={() => setConfirm('early')}
            />
          )}
          <Button secondary small title="End session" onPress={() => setConfirm('end')} />
        </View>
      )}
    </ScrollView>
  );
}

function DiscardControl({
  open,
  setOpen,
  onDiscard,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  onDiscard: () => void;
}) {
  if (!open)
    return <Button secondary small title="Discard this session" onPress={() => setOpen(true)} />;
  return (
    <View style={[styles.card, { gap: 10, borderColor: palette.danger }]}>
      <Text style={styles.body}>Discard this session? Nothing about it is recorded.</Text>
      <View style={styles.row}>
        <Button secondary small title="Discard session" onPress={onDiscard} />
        <Button small title="Keep it" onPress={() => setOpen(false)} />
      </View>
    </View>
  );
}

function BigButton({
  title,
  label,
  tone,
  onPress,
}: {
  title: string;
  label: string;
  /** Fern for the step that moves on (Resume, the next stage), Ember for Pause. */
  tone: 'done' | 'now';
  onPress: () => void;
}) {
  const fern = tone === 'done';
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        {
          minHeight: 64,
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderRadius: radius.card,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: fern ? palette.done : palette.accentTint,
          borderWidth: 1,
          borderColor: fern ? palette.done : palette.accentEdge,
        },
        !fern && glows.active,
      ]}>
      <Text
        maxFontSizeMultiplier={1.3}
        style={{
          ...fonts.bold,
          fontSize: 18,
          lineHeight: 24,
          textAlign: 'center',
          color: fern ? palette.onDone : palette.label,
        }}>
        {title}
      </Text>
    </PressableScale>
  );
}

/** A recorded session: what each stage ran, and the explicit choices that remain. */
function Recorded({ date, block, close }: { date: string; block: Block; close: () => void }) {
  const { state, change } = useApp();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const session = studySessionFor(state, block.id)!;
  const record = session.study!;
  const full = fullStudy(record);
  // Once a session is recorded, no saved run for this objective may linger to be recorded again.
  useEffect(() => {
    void saveStudyRun(block.id, null).catch(() => {});
  }, [block.id]);
  const stages = recordStages(record);
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, gap: 16 }}>
      <Text
        accessibilityRole="header"
        style={{
          ...type.callout,
          fontSize: 16,
          lineHeight: 22,
          color: full ? palette.done : palette.label,
        }}>
        {full ? 'Study recorded' : 'Shorter session recorded'}
      </Text>
      <Text style={{ ...type.count, color: full ? palette.done : palette.label }}>
        {minutesLine(record)}
      </Text>
      <StageBar stages={stages} />
      <StageList stages={stages} />
      {block.status !== 'done' && (
        <>
          <Button
            title={full ? 'Mark done' : 'Count it as done'}
            label={`Mark ${block.title} done from the recorded session`}
            onPress={() =>
              void change((s) => markStudyDone(s, date, block.id, new Date().toISOString())).then(
                (ok) => ok && close(),
              )
            }
          />
          {!full && (
            <Text style={styles.muted}>
              Counts for Day Cleared. Progress shows it as a shorter session.
            </Text>
          )}
        </>
      )}
      {confirmRemove ? (
        <View style={[styles.card, { gap: 10, borderColor: palette.danger }]}>
          <Text style={styles.body}>
            Remove this recorded session? The objective goes back to not done.
          </Text>
          <View style={styles.row}>
            <Button
              secondary
              small
              title="Remove session"
              onPress={() =>
                void change((s) => discardStudySession(s, date, block.id)).then(
                  (ok) => ok && setConfirmRemove(false),
                )
              }
            />
            <Button small title="Keep it" onPress={() => setConfirmRemove(false)} />
          </View>
        </View>
      ) : (
        <Button
          secondary
          small
          title="Recorded by mistake?"
          label="Remove this recorded study session"
          onPress={() => setConfirmRemove(true)}
        />
      )}
    </ScrollView>
  );
}
