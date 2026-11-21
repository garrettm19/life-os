import { State, nextSource } from './model';

function checked(title: string, desiredState: string): { title: string; desiredState: string } {
  const name = title.trim();
  const criteria = desiredState.trim();
  if (!name || name.length > 200) throw new Error('Use a goal title between 1 and 200 characters.');
  if (criteria.length > 10000)
    throw new Error('Keep success criteria to 10,000 characters or fewer.');
  return { title: name, desiredState: criteria };
}

/** Adds a goal. Inside the demo it stays the demo (`nextSource`). */
export function addGoal(state: State, id: string, title: string, desiredState: string): State {
  if (state.goals.some((goal) => goal.id === id)) throw new Error('This goal already exists.');
  return {
    ...state,
    source: nextSource(state),
    goals: [...state.goals, { id, ...checked(title, desiredState) }],
  };
}

export function updateGoal(state: State, id: string, title: string, desiredState: string): State {
  if (!state.goals.some((goal) => goal.id === id))
    throw new Error('This goal no longer exists. Close the editor and try again.');
  const fields = checked(title, desiredState);
  return {
    ...state,
    goals: state.goals.map((goal) => (goal.id === id ? { ...goal, ...fields } : goal)),
  };
}
