import { saveCheckpoint } from './checkpoints';
import { DEMO } from './demo-catalog';
import { defaultReviewDate, startFocus } from './focus';
import { State, dateObject, shiftDate, weekStartOf } from './model';
import { saveWeeklyReview } from './weekly-reviews';

// The demo's direction records, all fictional: a career focus chosen four weeks ago, two weekly
// course corrections (a change of approach after a stuck fortnight, then late shifts), and skill
// checkpoints (a baseline and a later result under the same conditions, plus an easier untimed set
// that is shown on its own). Made through the app's own functions, like the rest of the demo.

const at = (date: string, hour: number) => {
  const d = dateObject(date);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

export function withDemoDirection(state: State, today: string): State {
  const start = shiftDate(today, -27);
  let s = startFocus(
    state,
    {
      title: 'Get faster at new problems',
      goalId: 'demo-career',
      outcome: 'Solve new medium problems within 45 minutes, and take a career step every weekday.',
      evidence: 'career',
      routineIds: [DEMO.study, DEMO.careerStep],
      leadRoutineId: DEMO.study,
      cue: 'If I am putting it off after dinner, I open the course and start with one problem.',
      baseline: '1 of 4 new medium problems in 45 minutes',
      target: '3 of 4',
      reviewDate: defaultReviewDate(start),
    },
    'demo-focus',
    at(start, 9),
  );
  const checkpoint = (id: string, date: string, extra: object) =>
    (s = saveCheckpoint(
      s,
      {
        date,
        method: 'Course site, new problems',
        difficulty: 'medium',
        attempted: 4,
        solved: 1,
        minutes: 45,
        fresh: true,
        topics: '',
        next: '',
        ...extra,
      },
      id,
      at(date, 20),
    ));
  checkpoint('demo-checkpoint-1', shiftDate(today, -26), { next: 'Two pointers' });
  checkpoint('demo-checkpoint-2', shiftDate(today, -12), {
    method: 'Warm-up set',
    difficulty: 'easy',
    minutes: null,
    solved: 4,
  });
  checkpoint('demo-checkpoint-3', shiftDate(today, -5), { solved: 2, next: 'Graphs' });
  const twoWeeksAgo = shiftDate(weekStartOf(today), -14);
  s = saveWeeklyReview(
    s,
    {
      weekStart: twoWeeksAgo,
      obstacle: 'Stuck on the same kind of problem two weeks running',
      adjustment: 'Fewer new problems, two timed review sessions instead',
      noChange: false,
    },
    'demo-week-2',
    at(shiftDate(twoWeeksAgo, 6), 19),
  );
  const lastWeek = shiftDate(weekStartOf(today), -7);
  s = saveWeeklyReview(
    s,
    {
      weekStart: lastWeek,
      obstacle: 'Late shifts on Tuesday and Thursday',
      adjustment: 'Study before dinner on late-shift days',
      noChange: false,
    },
    'demo-week-1',
    at(shiftDate(lastWeek, 6), 19),
  );
  return s;
}
