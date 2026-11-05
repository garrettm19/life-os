import { expect, test } from '@jest/globals';
import { basicState } from '../../test-support/basic-state';
import { updateGoal } from '../goals';
import { generateDay, setStatus } from '../planner';

test('editing a goal preserves identity, linked programs and recorded plan history', () => {
  const state = basicState();
  const day = generateDay('2026-11-09', state.settings, state.programs);
  state.days[day.date] = setStatus(day, day.blocks[0].id, 'done');
  const result = updateGoal(
    state,
    'vitality',
    '  Strength target  ',
    '  Complete planned sessions  ',
  );
  expect(result.goals.find((goal) => goal.id === 'vitality')).toEqual({
    id: 'vitality',
    title: 'Strength target',
    desiredState: 'Complete planned sessions',
  });
  expect(result.programs).toBe(state.programs);
  expect(result.days).toBe(state.days);
  expect(result.goals.filter((goal) => goal.id !== 'vitality')).toEqual(
    state.goals.filter((goal) => goal.id !== 'vitality'),
  );
  expect(state.goals[0].title).toBe('Build strength');
});

test('invalid or stale goal edits fail; undecided criteria remain blank', () => {
  const state = basicState();
  expect(() => updateGoal(state, 'missing', 'Name', 'Target')).toThrow(/no longer exists/);
  expect(() => updateGoal(state, 'vitality', '  ', 'Target')).toThrow(/title/);
  expect(() => updateGoal(state, 'vitality', 'x'.repeat(201), 'Target')).toThrow(/title/);
  expect(() => updateGoal(state, 'vitality', 'Name', 'x'.repeat(10001))).toThrow(/criteria/);
  expect(updateGoal(state, 'vitality', 'Name', ' ').goals[0].desiredState).toBe('');
});
