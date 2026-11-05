import { basicState } from './basic-state';
import { Program, State, StudyPlan, WorkoutTemplate } from '../domain/model';
import { DSA_STUDY, copyStudyPlan } from '../domain/study';

// Synthetic training setup: Upper body on Mondays and Fridays, Lower body on Wednesdays, both
// checklist workouts in one Training program, plus a weekly weigh-in and money review. Nothing
// here is a real training plan.

// Local noon on Monday 2026-11-09, built from the local calendar so every zone agrees on the day.
export const AT = new Date(2026, 10, 9, 12).toISOString();

export function trainingState(): State {
  const state = basicState();
  state.source = 'personal';
  const training: Program = {
    id: 'training',
    title: 'Training',
    group: 'Training',
    goalIds: ['vitality'],
    routines: [
      {
        id: 'upper',
        title: 'Upper body',
        duration: 60,
        weekdays: [1, 5],
        preferredStart: null,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
        checklist: true,
      },
      {
        id: 'lower',
        title: 'Lower body',
        duration: 60,
        weekdays: [3],
        preferredStart: null,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
        checklist: true,
      },
    ],
  };
  const tracking: Program = {
    id: 'tracking',
    title: 'Tracking',
    group: 'Weekly',
    goalIds: ['vitality', 'money'],
    routines: [
      {
        id: 'weigh-in',
        title: 'Weekly weigh-in',
        duration: null,
        weekdays: [0],
        preferredStart: null,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
        checklist: true,
        private: true,
        capture: 'weight',
      },
      {
        id: 'money-check',
        title: 'Money review',
        duration: null,
        weekdays: [0],
        preferredStart: null,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
        checklist: true,
        private: true,
        capture: 'money',
      },
    ],
  };
  state.programs = [training, tracking];
  state.workoutTemplates = [template('upper', 'Upper body'), template('lower', 'Lower body')];
  return state;
}

export function template(routineId: string, title: string): WorkoutTemplate {
  return {
    id: `template-${routineId}`,
    routineId,
    title,
    note: '',
    updatedAt: AT,
    exercises: [
      {
        id: `${routineId}-a`,
        name: routineId === 'upper' ? 'Bench press' : 'Squat',
        sets: 3,
        repsMin: 8,
        repsMax: null,
        load: 135,
        unit: 'lb',
        restSeconds: 120,
        note: '',
      },
      {
        id: `${routineId}-b`,
        name: routineId === 'upper' ? 'Lat pulldown' : 'Romanian deadlift',
        sets: 3,
        repsMin: 10,
        repsMax: 12,
        load: null,
        unit: 'lb',
        restSeconds: null,
        note: 'Controlled lowering',
      },
    ],
  };
}

/**
 * Synthetic career setup on top of the training one: a daily study objective with the 25 + 30 + 5
 * minute plan and a weekday job-search checklist in a Career program.
 */
/** The default study plan with one synthetic resource on its first stage. */
function withCourseLink(plan: StudyPlan): StudyPlan {
  const [first, ...rest] = plan.stages;
  return {
    ...plan,
    stages: [
      { ...first, links: [{ label: 'Course notes', url: 'https://example.com/course' }] },
      ...rest,
    ],
  };
}

export function studyState(): State {
  const state = trainingState();
  const career: Program = {
    id: 'career',
    title: 'Career',
    group: 'Career',
    goalIds: [],
    routines: [
      {
        id: 'study',
        title: 'Daily study',
        duration: null,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        preferredStart: null,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
        checklist: true,
        study: {
          ...withCourseLink(copyStudyPlan(DSA_STUDY)),
          trackFrom: '2026-01-01',
          schedule: [{ from: '2026-01-01', weekdays: [0, 1, 2, 3, 4, 5, 6], enabled: true }],
        },
      },
      {
        id: 'job-search',
        title: 'Job search',
        duration: null,
        weekdays: [1, 2, 3, 4, 5],
        preferredStart: null,
        enabled: true,
        fixed: false,
        steps: ['Apply, tailor a resume, follow up or prepare for an interview.'],
        bundledInto: null,
        checklist: true,
      },
    ],
  };
  state.programs = [...state.programs, career];
  return state;
}

/** The synthetic morning anchor time used in tests: 7:10 AM, in minutes after midnight. */
export const UP_BY = 430;

/**
 * Synthetic morning anchor on top of the training setup: a daily checklist routine "Up by 7:10"
 * placed first in the day, carrying the anchor from `from` at `upBy`.
 */
export function anchorState(from = '2026-11-02', upBy = UP_BY): State {
  const state = trainingState();
  const mornings: Program = {
    id: 'mornings',
    title: 'Mornings',
    group: 'Foundation',
    goalIds: [],
    routines: [
      {
        id: 'up',
        title: 'Up by 7:10',
        duration: null,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        preferredStart: null,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
        checklist: true,
        dayOrder: 0,
        anchor: { history: [{ from, upBy }] },
      },
    ],
  };
  state.programs = [mornings, ...state.programs];
  return state;
}
