import type { IntervalPlan, State } from '../../src/domain/model';
import { trainingState } from '../../src/test-support/fixtures';
import { CORE_CIRCUIT, newCircuit, saveCircuit } from '../../src/domain/intervals';

/**
 * The training fixture plus a Tuesday checklist objective (routine `abs`) timed by the circuit
 * `plan`.
 */
export function circuitState(plan: IntervalPlan = CORE_CIRCUIT, title = 'Core circuit'): State {
  const base = trainingState();
  const state: State = {
    ...base,
    programs: base.programs.map((p) =>
      p.id === 'training'
        ? {
            ...p,
            routines: [
              ...p.routines,
              {
                id: 'abs',
                title,
                duration: null,
                weekdays: [2],
                preferredStart: null,
                enabled: true,
                fixed: false,
                steps: [],
                bundledInto: null,
                checklist: true,
              },
            ],
          }
        : p,
    ),
  };
  return saveCircuit(
    state,
    newCircuit('abs', title, plan, 'circuit-1', '2026-01-01T00:00:00.000Z'),
  );
}
