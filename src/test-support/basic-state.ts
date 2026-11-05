import { Program, State, emptyState } from '../domain/model';

/**
 * A small generic state for tests: four timed programs, marked as a demo so tests of importing over
 * a demo apply to it.
 */
export function basicState(): State {
  const s = emptyState();
  s.source = 'demo';
  s.goals = [
    {
      id: 'vitality',
      title: 'Build strength',
      desiredState: 'Train consistently and recover well',
    },
    {
      id: 'career',
      title: 'Grow my career',
      desiredState: 'Develop skills and find the right next role',
    },
    {
      id: 'money',
      title: 'Organize my money',
      desiredState: 'Know my position and follow a plan',
    },
    {
      id: 'home',
      title: 'Run the home well',
      desiredState: 'Keep the home, meals and appointments in order',
    },
  ];
  const program = (
    id: string,
    title: string,
    group: string,
    goalIds: string[],
    duration: number,
    start: number,
    weekdays: number[],
  ): Program => ({
    id,
    title,
    group,
    goalIds,
    routines: [
      {
        id: `${id}-1`,
        title,
        duration,
        preferredStart: start,
        weekdays,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
      },
    ],
  });
  s.programs = [
    program('morning', 'Morning reset', 'Foundation', ['vitality'], 20, 540, [0, 1, 2, 3, 4, 5, 6]),
    program('strength', 'Strength session', 'Training', ['vitality'], 60, 780, [1, 3, 5]),
    program('study', 'Interview practice', 'Career', ['career'], 45, 1020, [1, 2, 3, 4, 5]),
    program('money', 'Money review', 'Administration', ['money', 'home'], 20, 1080, [0]),
  ];
  s.settings.workStart = 600;
  s.settings.workEnd = 720;
  s.settings.scrumStart = 660;
  s.settings.scrumDuration = 15;
  return s;
}
