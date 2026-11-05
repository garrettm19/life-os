import { newCircuit } from './intervals';
import {
  Goal,
  IntervalRoutine,
  PlannedExercise,
  Program,
  Routine,
  RuleBook,
  StudyPlan,
  WorkoutTemplate,
} from './model';
import { defaultTradingProfile } from './trading';
import { DAILY_RULES } from './trading-rules';

// The demo's catalog: the goals, routines and example values of the demo's fictional person, used
// by the demo (demo.ts, demo-direction.ts) and its tests. The trading rules are the app's built-in
// daily rules (trading-rules.ts).

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const MON_TO_SAT = [1, 2, 3, 4, 5, 6];

export const DEMO = {
  morning: 'demo-morning',
  mobility: 'demo-mobility',
  weighIn: 'demo-weigh-in',
  gym: 'demo-gym',
  chestA: 'demo-chest-a',
  backA: 'demo-back-a',
  legsA: 'demo-legs-a',
  chestB: 'demo-chest-b',
  backB: 'demo-back-b',
  legsB: 'demo-legs-b',
  knees: 'demo-knees-ankles',
  core: 'demo-core',
  neck: 'demo-neck',
  cardio: 'demo-cardio',
  study: 'demo-study',
  project: 'demo-project',
  careerStep: 'demo-career-step',
  money: 'demo-money',
  home: 'demo-home-reset',
  trading: 'demo-trading',
} as const;

/**
 * The demo's order of the day: waking up and the morning first, work and training through the day,
 * the weekly resets in the evening. The rotation's workouts share one place.
 */
const PLACE = {
  morning: 0,
  weighIn: 10,
  mobility: 20,
  trading: 30,
  careerStep: 40,
  study: 50,
  project: 60,
  gym: 70,
  core: 80,
  neck: 90,
  cardio: 100,
  home: 110,
  money: 120,
} as const;

/** The six-workout rotation, in order. */
export const DEMO_ROTATION: string[] = [
  DEMO.chestA,
  DEMO.backA,
  DEMO.legsA,
  DEMO.chestB,
  DEMO.backB,
  DEMO.legsB,
];

function routine(id: string, title: string, weekdays: number[], extra: Partial<Routine> = {}) {
  return {
    id,
    title,
    duration: null,
    weekdays,
    preferredStart: null,
    enabled: true,
    fixed: false,
    steps: [],
    bundledInto: null,
    checklist: true,
    ...extra,
  } satisfies Routine;
}

/**
 * The fictional person's life goals. Three have no scheduled objective on purpose: guitar,
 * presence and wellbeing are directions, noted in the life log rather than ticked as checkboxes
 * (docs/FEATURES.md).
 */
export const DEMO_GOALS: Goal[] = [
  {
    id: 'demo-sleep',
    title: 'Sleep and energy first',
    desiredState:
      'About eight hours in bed most nights and mornings that start outside. Poor recovery means an easier day, not a harder one.',
  },
  {
    id: 'demo-strong',
    title: 'Get stronger',
    desiredState:
      'Six-workout rotation kept most weeks, main lifts creeping up, knees and ankles that stay healthy.',
  },
  {
    id: 'demo-endurance',
    title: 'Run a 10K',
    desiredState:
      'Easy cardio twice a week, pickleball with friends, and a 10K in the spring. A half-marathon is a later idea, not a daily target.',
  },
  {
    id: 'demo-career',
    title: 'Grow as a developer',
    desiredState:
      'Solve new problems reliably, finish a small app worth showing, and share what I learn. Study time alone does not prove skill.',
  },
  {
    id: 'demo-money',
    title: 'Save for a trip',
    desiredState:
      'Bills paid on time, the car loan paid down on schedule, and $2,000 saved for a summer trip. No trading income in the plan.',
  },
  {
    id: 'demo-friends',
    title: 'Close friends and a social life',
    desiredState:
      'Reach out first, keep a recurring group activity, and say yes to plans and new people.',
  },
  {
    id: 'demo-guitar',
    title: 'Learn guitar',
    desiredState:
      'Play a handful of songs start to finish by the end of the year, for fun. Practice when it fits; no quotas.',
  },
  {
    id: 'demo-presence',
    title: 'Speak with confidence',
    desiredState:
      'Explain technical work clearly, give a short talk at a meetup, listen well in conversation.',
  },
  {
    id: 'demo-wellbeing',
    title: 'A steady mind',
    desiredState:
      'Take setbacks in stride, keep evenings calm and screen-light, and ask for support when it is needed.',
  },
  {
    id: 'demo-household',
    title: 'Run the home well',
    desiredState:
      'Keep the apartment, meals and appointments in order without last-minute scrambles.',
  },
  {
    id: 'demo-build',
    title: 'Build useful things',
    desiredState:
      'Ship small software projects and learn by implementing. After sleep, health and money, not before.',
  },
  {
    id: 'demo-enjoy',
    title: 'Enjoy life',
    desiredState: 'Friends, sport, games, trips and new experiences, with no justification needed.',
  },
];

/** The demo's study plan; its streak starts on `trackFrom`, never earlier. Monday to Saturday. */
function demoStudyPlan(trackFrom: string): StudyPlan {
  return {
    stages: [
      {
        id: 'learn',
        title: 'Practice problems',
        minutes: 25,
        links: [{ label: 'Practice site (example)', url: 'https://example.com/practice' }],
      },
      {
        id: 'practice',
        title: 'One new topic from the course',
        minutes: 15,
        links: [],
      },
      { id: 'review', title: 'Notes, explained out loud', minutes: 5, links: [] },
    ],
    at: null,
    reminders: { start: false, evening: null, stageEnd: false },
    trackFrom,
    schedule: [{ from: trackFrom, weekdays: MON_TO_SAT, enabled: true }],
  };
}

export function demoPrograms(studyFrom: string): Program[] {
  return [
    {
      id: 'demo-foundations',
      title: 'Morning foundations',
      group: 'Foundations',
      goalIds: ['demo-sleep', 'demo-strong'],
      routines: [
        // Plain words, no times or amounts, in the order they are done. Wake time itself is a setting,
        // never an objective.
        routine(DEMO.morning, 'Morning', EVERY_DAY, {
          dayOrder: PLACE.morning,
          steps: ['Walk', 'Sunlight', 'Water', 'Supplements'],
        }),
        routine(DEMO.mobility, 'Mobility', EVERY_DAY, {
          dayOrder: PLACE.mobility,
          alternate: {
            anchor: '2026-01-05',
            variants: [
              {
                title: 'Hips and legs',
                steps: [
                  '90/90 hip rotations — 2 × 8',
                  'Deep squat hold — 1 min',
                  'Ankle rocks — 2 × 10',
                ],
              },
              {
                title: 'Shoulders and back',
                steps: ['Wall slides — 2 × 10', 'Thoracic rotations — 2 × 8', 'Doorway stretch'],
              },
            ],
          },
        }),
        routine(DEMO.weighIn, 'Morning weigh-in', EVERY_DAY, {
          dayOrder: PLACE.weighIn,
          capture: 'weight',
          optional: true,
          private: true,
        }),
      ],
    },
    {
      id: DEMO.gym,
      title: 'Strength',
      group: 'Training',
      goalIds: ['demo-strong'],
      routines: [
        routine(DEMO.chestA, 'Chest / Triceps / Shoulders A', [], { dayOrder: PLACE.gym }),
        routine(DEMO.backA, 'Back / Biceps A', [], { dayOrder: PLACE.gym }),
        routine(DEMO.legsA, 'Legs A', [], { dayOrder: PLACE.gym }),
        routine(DEMO.chestB, 'Chest / Triceps / Shoulders B', [], { dayOrder: PLACE.gym }),
        routine(DEMO.backB, 'Back / Biceps B', [], { dayOrder: PLACE.gym }),
        routine(DEMO.legsB, 'Legs B', [], { dayOrder: PLACE.gym }),
        // Inside the day's workout: shares its time, recorded on its own, never by the workout.
        routine(DEMO.knees, 'Knees and ankles (ATG)', [1, 4], {
          bundledInto: DEMO.gym,
          steps: [
            'Tibialis raises — 2 × 20',
            'Calf raises, full range — 2 × 15',
            'Backward walk or sled — 3 × 30 m',
            'ATG split squat — 2 × 8 each side',
            'Hamstring curl or Nordic negative — 2 × 6',
          ],
        }),
      ],
      rotation: { order: DEMO_ROTATION, restDays: [0, 3], startWith: DEMO.chestA },
    },
    {
      id: 'demo-home',
      title: 'Home extras',
      group: 'Training',
      goalIds: ['demo-strong'],
      routines: [
        routine(DEMO.core, 'Ab circuit', [], {
          follows: [DEMO.chestA, DEMO.chestB],
          dayOrder: PLACE.core,
        }),
        routine(DEMO.neck, 'Neck', [], {
          dayOrder: PLACE.neck,
          follows: [DEMO.backA, DEMO.backB],
          steps: ['Neck flexion, light band — 2 × 15', 'Neck extension, light band — 2 × 15'],
        }),
      ],
    },
    {
      id: 'demo-cardio-program',
      title: 'Cardio and sport',
      group: 'Training',
      goalIds: ['demo-endurance', 'demo-friends', 'demo-enjoy'],
      routines: [
        routine(DEMO.cardio, 'Easy cardio', [0, 3], {
          dayOrder: PLACE.cardio,
          duration: 30,
          capture: 'activity',
          activities: ['Easy run', 'Bike', 'Pickleball', 'Brisk walk'],
          steps: ['Conversational pace. Pickleball with friends counts.'],
        }),
      ],
    },
    {
      id: 'demo-career-program',
      title: 'Engineering skills',
      group: 'Career',
      goalIds: ['demo-career', 'demo-build'],
      routines: [
        routine(DEMO.study, 'Coding practice', MON_TO_SAT, {
          study: demoStudyPlan(studyFrom),
          dayOrder: PLACE.study,
        }),
        routine(DEMO.project, 'Portfolio project', [6], {
          dayOrder: PLACE.project,
          optional: true,
          steps: [
            'Ship one small slice of the recipe app: a feature, a test or a fix',
            'Write two lines in the README about what changed',
          ],
        }),
      ],
    },
    {
      id: 'demo-career-steps',
      title: 'Career steps',
      group: 'Career',
      goalIds: ['demo-career'],
      routines: [
        routine(DEMO.careerStep, 'Career step', WEEKDAYS, {
          dayOrder: PLACE.careerStep,
          steps: [
            'One of: write up something I learned, review a pull request on an open-source project, ask a colleague about their work, or prepare the meetup talk.',
          ],
        }),
      ],
    },
    {
      id: 'demo-money-program',
      title: 'Money',
      group: 'Weekly',
      goalIds: ['demo-money', 'demo-household'],
      routines: [
        routine(DEMO.money, 'Money check-in', [0], {
          dayOrder: PLACE.money,
          capture: 'money',
          private: true,
          steps: [
            'Bills and minimum payments due this week',
            'Cash, savings and debt, then one priority for the week',
          ],
        }),
      ],
    },
    {
      id: 'demo-home-program',
      title: 'Home',
      group: 'Weekly',
      goalIds: ['demo-household'],
      routines: [
        routine(DEMO.home, 'Home reset', [6], {
          dayOrder: PLACE.home,
          steps: [
            'Laundry, and put clothes away',
            'Clean the room and bathroom',
            'Groceries for the week',
            'Book any appointment that is due',
          ],
        }),
      ],
    },
    {
      id: 'demo-trading-program',
      title: 'Trading practice',
      group: 'Paused',
      goalIds: [],
      routines: [
        // Off until the day the process starts, then paused a week before today after a
        // rule-broken stretch (demo.ts). Trading stays open for planning and no-trade decisions.
        routine(DEMO.trading, 'Follow my trading plan', WEEKDAYS, {
          dayOrder: PLACE.trading,
          capture: 'rules',
          enabled: false,
          private: true,
        }),
      ],
    },
  ];
}

function exercise(id: string, name: string, sets: number, reps: number, load: number) {
  return {
    id,
    name,
    sets,
    repsMin: reps,
    repsMax: reps + 2,
    load,
    unit: 'lb',
    restSeconds: 90,
    note: '',
  } satisfies PlannedExercise;
}

export function demoTemplates(now: string): WorkoutTemplate[] {
  const plan = (routineId: string, title: string, exercises: PlannedExercise[]) => ({
    id: `plan-${routineId}`,
    routineId,
    title,
    note: '',
    exercises,
    updatedAt: now,
  });
  // Shared exercise IDs (bench, row, squat…) keep one history across the A and B days.
  return [
    plan(DEMO.chestA, 'Chest / Triceps / Shoulders A', [
      exercise('bench', 'Bench press', 3, 6, 155),
      exercise('ohp', 'Overhead press', 3, 8, 85),
      exercise('cable-fly', 'Cable fly', 2, 12, 30),
      exercise('pushdown', 'Triceps pushdown', 2, 12, 45),
    ]),
    plan(DEMO.backA, 'Back / Biceps A', [
      exercise('row', 'Barbell row', 3, 8, 135),
      exercise('pulldown', 'Lat pulldown', 3, 10, 120),
      exercise('face-pull', 'Face pull', 2, 15, 35),
      exercise('curl', 'Dumbbell curl', 2, 12, 30),
    ]),
    plan(DEMO.legsA, 'Legs A', [
      exercise('squat', 'Back squat', 3, 5, 185),
      exercise('rdl', 'Romanian deadlift', 3, 8, 155),
      exercise('leg-curl', 'Seated leg curl', 2, 12, 70),
    ]),
    plan(DEMO.chestB, 'Chest / Triceps / Shoulders B', [
      exercise('incline-db', 'Incline dumbbell press', 3, 8, 55),
      exercise('dips', 'Dips', 3, 10, 0),
      exercise('lateral', 'Lateral raise', 3, 15, 15),
      exercise('overhead-ext', 'Overhead triceps extension', 2, 12, 40),
    ]),
    plan(DEMO.backB, 'Back / Biceps B', [
      exercise('deadlift', 'Deadlift', 3, 5, 225),
      exercise('chinup', 'Chin-up', 3, 6, 0),
      exercise('cable-row', 'Seated cable row', 2, 12, 110),
      exercise('hammer', 'Hammer curl', 2, 12, 30),
    ]),
    plan(DEMO.legsB, 'Legs B', [
      exercise('front-squat', 'Front squat', 3, 6, 135),
      exercise('hip-thrust', 'Hip thrust', 3, 10, 185),
      exercise('lunge', 'Walking lunge', 2, 10, 40),
    ]),
  ];
}

/** A short timed circuit: 10 s to get ready, six 40-second intervals with rests between. */
export function demoCircuit(now: string): IntervalRoutine {
  const names = ['Dead bug', 'Plank', 'Side plank — left', 'Side plank — right', 'Hollow hold'];
  return newCircuit(
    DEMO.core,
    'Ab circuit',
    {
      prepSeconds: 10,
      steps: [...names, 'Bird dog'].map((name, i, all) => ({
        id: `core-${i + 1}`,
        name,
        seconds: 40,
        restAfter: i === all.length - 1 ? 0 : 20,
      })),
    },
    'circuit-demo-core',
    now,
  );
}

/**
 * A trading rulebook that uses the built-in daily rules as example rules: not advice and not an
 * endorsement of trading at these levels. The process starts on `since`. The written limits are
 * text the app never enforces or checks; the example instrument and risk limits are what the
 * cockpit's risk check reads, labelled as examples.
 */
export function demoRuleBook(since: string, now: string): RuleBook {
  return {
    id: 'rulebook-demo-trading',
    routineId: DEMO.trading,
    title: 'Trading plan',
    checkpoints: [
      { id: 'checkpoint-1', text: 'Marked my levels before the open' },
      { id: 'checkpoint-2', text: 'Stopped at my daily limit' },
    ],
    // The fifteen built-in daily rules, as on the bias board.
    rules: DAILY_RULES.map((r) => ({
      id: `rule-${r.n}`,
      title: r.title,
      details: r.lines.join('\n'),
    })),
    updatedAt: now,
    trading: {
      ...defaultTradingProfile(since),
      maxFailedTheses: 2,
      maxEntries: 2,
      // Example values only, labelled as such: no real account, instrument or amount.
      instrument: { name: 'MNQ (example)', pointValue: 2, tick: 0.25 },
      risk: { maxContracts: 5, thesisRisk: 150, dailyLoss: 300 },
      limits: [
        { id: 'limit-1', label: 'Instrument', value: 'MNQ (example)' },
        { id: 'limit-2', label: 'Maximum position', value: '5 MNQ' },
        { id: 'limit-3', label: 'Maximum risk per thesis', value: '$150' },
        { id: 'limit-4', label: 'Maximum daily loss', value: '$300' },
        { id: 'limit-5', label: 'Entries', value: '1 ideal · 2 maximum' },
        { id: 'limit-6', label: 'Failed theses', value: '2 per day · done for the day' },
      ],
    },
  };
}
