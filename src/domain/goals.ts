import { State } from './model';

export function updateGoal(state: State, id: string, title: string, desiredState: string): State {
  if (!state.goals.some((goal) => goal.id === id))
    throw new Error('This goal no longer exists. Close the editor and try again.');
  const name = title.trim();
  const criteria = desiredState.trim();
  if (!name || name.length > 200) throw new Error('Use a goal title between 1 and 200 characters.');
  if (criteria.length > 10000)
    throw new Error('Keep success criteria to 10,000 characters or fewer.');
  return {
    ...state,
    goals: state.goals.map((goal) =>
      goal.id === id ? { ...goal, title: name, desiredState: criteria } : goal,
    ),
  };
}
