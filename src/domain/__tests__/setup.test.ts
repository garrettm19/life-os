import { describe, expect, it } from '@jest/globals';
import { parseSetup, withDay } from '../data';
import { CORE_CIRCUIT, newCircuit } from '../intervals';
import { Program, Routine, State, emptyState, localDate } from '../model';
import { setStatus, ensureChecklistDay } from '../planner';
import { MAX_VIOLATIONS } from '../records';
import { importSetup, keptRecordsText, previewSetup } from '../setup';
import { upsertRoutine } from '../routines';
import { defaultTradingProfile, enableTrading, tradingBook } from '../trading';
import { trainingState, template } from '../../test-support/fixtures';

// Synthetic setup files only.
const AT = '2026-11-09T12:00:00.000Z';
const routine = (id: string, title: string) => ({
  id,
  title,
  duration: null,
  weekdays: [1],
  preferredStart: null,
  enabled: true,
  fixed: false,
  steps: [],
  bundledInto: null,
  checklist: true,
});

function setup(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    format: 'life-os-setup-v1',
    goals: [],
    programs: [
      {
        id: 'added',
        title: 'Added',
        group: 'Training',
        goalIds: [],
        routines: [routine('lift', 'Lift'), routine('core', 'Core'), routine('review', 'Review')],
      },
    ],
    ...extra,
  });
}

describe('setup import with plans, circuits and rulebooks', () => {
  it('adds them for routines that have none, and keeps settings and notes when the file has none', () => {
    const existing = { ...trainingState(), notes: ['Keep me'] };
    const result = parseSetup(
      setup({
        workoutTemplates: [{ ...template('lift', 'Lift'), id: 'plan-lift' }],
        intervalRoutines: [newCircuit('core', 'Core', CORE_CIRCUIT, 'circuit-core', AT)],
        ruleBooks: [
          {
            id: 'book',
            routineId: 'review',
            title: 'Rules',
            checkpoints: [{ id: 'checkpoint-1', text: 'Planned first' }],
            rules: [],
            updatedAt: AT,
          },
        ],
      }),
      existing,
      AT,
    );
    expect(result.workoutTemplates.map((t) => t.routineId)).toEqual(['upper', 'lower', 'lift']);
    expect(result.intervalRoutines.map((c) => c.routineId)).toEqual(['core']);
    expect(result.ruleBooks.map((b) => b.routineId)).toEqual(['review']);
    expect(result.settings).toEqual(existing.settings);
    expect(result.notes).toEqual(['Keep me']);
  });

  it('never replaces an existing plan, ignores records for unknown routines, and keeps history', () => {
    let existing = trainingState();
    existing = withDay(
      existing,
      ensureChecklistDay('2026-11-09', existing.settings, existing.programs, undefined, AT),
    );
    existing = withDay(
      existing,
      setStatus(existing.days['2026-11-09'], '2026-11-09:routine:upper', 'done', AT),
    );
    const replacement = { ...template('upper', 'Replaced'), id: 'other-plan' };
    const result = parseSetup(
      setup({
        workoutTemplates: [replacement, { ...template('nowhere', 'Nowhere'), id: 'orphan' }],
      }),
      existing,
      AT,
    );
    expect(result.workoutTemplates.find((t) => t.routineId === 'upper')!.title).toBe('Upper body');
    expect(result.workoutTemplates.some((t) => t.id === 'orphan')).toBe(false);
    expect(result.days['2026-11-09']).toEqual(existing.days['2026-11-09']);
  });

  it('refuses an invalid record before anything changes', () => {
    expect(() =>
      parseSetup(
        setup({ workoutTemplates: [{ ...template('lift', 'Lift'), exercises: [{ id: 'x' }] }] }),
        trainingState(),
        AT,
      ),
    ).toThrow();
  });
});

describe('re-importing a setup over a repeat set in the app', () => {
  // Counted from the week of Monday 2026-11-16, so the week of 2026-11-09 is an off week.
  const REPEAT = { everyWeeks: 3, anchor: '2026-11-16' };
  const WED = '2026-11-11';
  const stretch: Routine = { ...routine('stretch', 'Stretch'), weekdays: [3] };

  function device(): State {
    const state = trainingState();
    state.programs = state.programs.map((p) =>
      p.id === 'training' ? { ...p, routines: [...p.routines, { ...stretch, repeat: REPEAT }] } : p,
    );
    return state;
  }
  /** The training catalog as a setup file has it: no repeat, optionally edited. */
  function fileOf(edit: (p: Program) => Program = (p) => p): string {
    const state = trainingState();
    return JSON.stringify({
      format: 'life-os-setup-v1',
      goals: state.goals,
      programs: state.programs
        .filter((p) => p.id === 'training')
        .map((p) => edit({ ...p, routines: [...p.routines, stretch] })),
    });
  }
  const stretchOf = (state: State) =>
    state.programs.flatMap((p) => p.routines).find((r) => r.id === 'stretch')!;

  it('keeps the repeat, so an off week stays free, and says so in the preview', () => {
    const next = parseSetup(fileOf(), device(), AT);
    expect(stretchOf(next).repeat).toEqual(REPEAT);
    const wednesday = ensureChecklistDay(WED, next.settings, next.programs, undefined, AT);
    expect(wednesday.blocks.some((b) => b.routineId === 'stretch')).toBe(false);
    expect(previewSetup(fileOf(), device(), AT).keptOnDevice).toEqual([
      'Stretch: repeats every 3 weeks',
    ]);
  });

  it("follows the file's own repeat when it has one", () => {
    const file = fileOf((p) => ({
      ...p,
      routines: p.routines.map((r) =>
        r.id === 'stretch' ? { ...r, repeat: { everyWeeks: 2, anchor: WED } } : r,
      ),
    }));
    expect(stretchOf(parseSetup(file, device(), AT)).repeat).toEqual({
      everyWeeks: 2,
      anchor: WED,
    });
    expect(previewSetup(file, device(), AT).keptOnDevice).toEqual([]);
  });

  it('drops the repeat when the file makes the routine a bundled step or a rotation workout', () => {
    const bundled = fileOf((p) => ({
      ...p,
      routines: p.routines.map((r) =>
        r.id === 'stretch' ? { ...r, bundledInto: 'training', checklist: false } : r,
      ),
    }));
    expect(stretchOf(parseSetup(bundled, device(), AT)).repeat).toBeUndefined();
    expect(previewSetup(bundled, device(), AT).keptOnDevice).toEqual([]);
    const rotation = fileOf((p) => ({
      ...p,
      rotation: { order: ['upper', 'stretch'], restDays: [0, 6], startWith: null },
    }));
    const next = parseSetup(rotation, device(), AT);
    expect(stretchOf(next).repeat).toBeUndefined();
    expect(stretchOf(next).weekdays).toEqual([]);
    expect(previewSetup(rotation, device(), AT).keptOnDevice).toEqual([]);
  });
});

describe('setup import of a trading rulebook', () => {
  const tradingProgram: Program = {
    id: 'trading',
    title: 'Example trading',
    group: 'Private',
    goalIds: [],
    routines: [
      {
        ...routine('trade-rules', 'Example trading review'),
        weekdays: [1, 2, 3, 4, 5],
        private: true,
        capture: 'rules',
      },
    ],
  };
  const book = {
    id: 'book',
    routineId: 'trade-rules',
    title: 'Example rules',
    checkpoints: [{ id: 'checkpoint-1', text: 'An example checkpoint' }],
    rules: [],
    updatedAt: AT,
  };
  /** A device whose process was turned on in the app: the default 19 hard violations. */
  function device(): State {
    const state = { ...trainingState(), programs: [...trainingState().programs, tradingProgram] };
    return enableTrading({ ...state, ruleBooks: [book] }, 'trade-rules', AT);
  }
  /** A file carrying the same process with its own violation IDs, and one program more. */
  const file = (own: number) =>
    setup({
      programs: [
        tradingProgram,
        {
          id: 'added',
          title: 'Added',
          group: 'Training',
          goalIds: [],
          routines: [routine('lift', 'Lift')],
        },
      ],
      ruleBooks: [
        {
          ...book,
          trading: {
            ...defaultTradingProfile('2026-01-01'),
            violations: Array.from({ length: own }, (_, i) => ({
              id: `own-${i + 1}`,
              title: `Example violation ${i + 1}`,
              details: '',
            })),
          },
        },
      ],
    });

  it('adds new hard violations only while the process has room, and still imports the rest', () => {
    const before = tradingBook(device())!.trading!.violations;
    expect(before).toHaveLength(20);
    const next = parseSetup(file(11), device(), AT);
    const after = tradingBook(next)!.trading!.violations;
    expect(after).toHaveLength(MAX_VIOLATIONS);
    // The device's own come first and none is lost; the file's are added in order until full.
    expect(after.slice(0, 20)).toEqual(before);
    expect(after.slice(20).map((v) => v.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `own-${i + 1}`),
    );
    // The rest of the setup imports.
    expect(next.programs.some((p) => p.id === 'added')).toBe(true);
    const preview = previewSetup(file(11), device(), AT);
    expect(preview.tradingUpdated?.violationsAdded).toBe(10);
    expect(preview.violationsLeftOut).toEqual(['Example violation 11']);
    // A file that fits leaves nothing out.
    expect(previewSetup(file(10), device(), AT).violationsLeftOut).toEqual([]);
    // A full process takes none, and says which.
    const full = parseSetup(file(20), device(), AT);
    expect(tradingBook(parseSetup(file(20), full, AT))!.trading!.violations).toEqual(
      tradingBook(full)!.trading!.violations,
    );
    expect(previewSetup(file(20), full, AT).violationsLeftOut).toHaveLength(10);
  });

  it('counts a rulebook new from the file as added with its process, not as one gaining it', () => {
    const preview = previewSetup(file(1), { ...emptyState(), source: 'personal' }, AT);
    expect(preview.rulebooksAdded).toBe(1);
    expect(preview.rulebooksWithTrading).toBe(1);
    expect(preview.tradingAdded).toBe(0);
    expect(preview.violationsLeftOut).toEqual([]);
  });
});

describe('re-importing a setup over changes made in the app', () => {
  // Every routine is due every day, so the test means the same day in every time zone.
  const TODAY = localDate(new Date(AT));
  const everyDay = (id: string, title: string): Routine => ({
    ...routine(id, title),
    weekdays: [0, 1, 2, 3, 4, 5, 6],
  });
  const file = (walk = 'Walk') =>
    JSON.stringify({
      format: 'life-os-setup-v1',
      goals: [],
      programs: [
        {
          id: 'daily',
          title: 'Daily',
          group: 'Personal',
          goalIds: [],
          routines: [everyDay('cardio', 'Cardio'), everyDay('walk', walk)],
        },
      ],
    });
  const open = (state: State) =>
    withDay(
      state,
      ensureChecklistDay(TODAY, state.settings, state.programs, state.days[TODAY], AT),
    );
  const daily = (state: State) => state.programs.find((p) => p.id === 'daily')!;
  const rename = (state: State, id: string, title: string) =>
    upsertRoutine(
      state,
      daily(state),
      { ...daily(state).routines.find((r) => r.id === id)!, title },
      AT,
    );
  const block = (state: State, id: string) =>
    state.days[TODAY].blocks.find((b) => b.routineId === id)!;
  const imported = (state: State, raw = file()) =>
    importSetup(raw, state, AT, { pauseSameNamed: false });

  it('keeps a routine added in the app to an imported program, with its recorded occurrence', () => {
    let state = imported(emptyState());
    state = upsertRoutine(state, daily(state), everyDay('own', 'Example own habit'), AT);
    state = open(state);
    state = withDay(state, setStatus(state.days[TODAY], `${TODAY}:routine:own`, 'done', AT));
    const preview = previewSetup(file(), state, AT);
    expect(preview.routinesReplaced).not.toContain('Example own habit');
    const after = imported(state);
    expect(daily(after).routines.map((r) => r.id)).toEqual(['cardio', 'walk', 'own']);
    // Its done occurrence is still owned by a routine Programs can edit.
    expect(block(after, 'own').status).toBe('done');
    expect(after.days[TODAY]).toEqual(state.days[TODAY]);
    // An unchanged file again changes nothing.
    expect(imported(after)).toEqual(after);
  });

  it("gives today's planned occurrence the file's name back, never a recorded one", () => {
    let state = open(imported(emptyState()));
    state = withDay(state, setStatus(state.days[TODAY], `${TODAY}:routine:walk`, 'done', AT));
    state = rename(state, 'cardio', 'Run');
    state = rename(state, 'walk', 'Long walk');
    expect(block(state, 'cardio').title).toBe('Run');
    expect(block(state, 'walk').title).toBe('Walk');
    const after = imported(state, file('Evening walk'));
    expect(daily(after).routines.find((r) => r.id === 'cardio')!.title).toBe('Cardio');
    // The planned occurrence follows the file, as an edit in Programs does; the done one stays.
    expect(block(after, 'cardio')).toMatchObject({ title: 'Cardio', status: 'planned' });
    expect(block(after, 'walk')).toMatchObject({ title: 'Walk', status: 'done' });
    // A later rename in Programs still reaches today's row.
    expect(block(rename(after, 'cardio', 'Zone 2'), 'cardio').title).toBe('Zone 2');
  });
});

describe('the records a re-import leaves alone', () => {
  it('names each kind apart: a circuit and a rulebook are never called plans', () => {
    const raw = setup({
      intervalRoutines: [newCircuit('core', 'Core', CORE_CIRCUIT, 'circuit-core', AT)],
      ruleBooks: [
        {
          id: 'book',
          routineId: 'review',
          title: 'Rules',
          checkpoints: [{ id: 'checkpoint-1', text: 'Planned first' }],
          rules: [],
          updatedAt: AT,
        },
      ],
    });
    const first = previewSetup(raw, emptyState(), AT);
    expect(first.recordsKept).toEqual({ plans: 0, circuits: 0, rulebooks: 0 });
    expect(keptRecordsText(first.recordsKept)).toBe('');
    const again = previewSetup(raw, parseSetup(raw, emptyState(), AT), AT);
    expect(again.recordsKept).toEqual({ plans: 0, circuits: 1, rulebooks: 1 });
    expect(keptRecordsText(again.recordsKept)).toBe('1 timed circuit and 1 rulebook');
    expect(keptRecordsText({ plans: 2, circuits: 1, rulebooks: 3 })).toBe(
      '2 workout plans, 1 timed circuit and 3 rulebooks',
    );
  });
});
