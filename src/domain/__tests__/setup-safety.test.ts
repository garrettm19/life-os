import { describe, expect, it } from '@jest/globals';
import { demoState, isBlank } from '../demo';
import { DEMO } from '../demo-catalog';
import { Program, State, emptyState, shiftDate } from '../model';
import { importSetup, previewSetup, setupGaps } from '../setup';

// A device with six weeks of history (the fictional demo, treated as the user's own data) and a
// setup file holding the same catalog: importing must keep every record and every device choice.
const TODAY = '2026-11-09';
const NOW = new Date(2026, 10, 9, 12).toISOString();

function device(): State {
  return { ...demoState(TODAY), source: 'personal' };
}

function fileOf(state: State, programs: Program[] = state.programs): string {
  // A setup file carries the catalog only: no study start, no history.
  const clean = programs.map((p) => ({
    ...p,
    routines: p.routines.map((r) => {
      if (!r.study) return r;
      const study = { ...r.study };
      delete study.trackFrom;
      delete study.schedule;
      return { ...r, study };
    }),
  }));
  return JSON.stringify({
    format: 'life-os-setup-v1',
    goals: state.goals,
    programs: clean,
    workoutTemplates: state.workoutTemplates,
    intervalRoutines: state.intervalRoutines,
    ruleBooks: state.ruleBooks,
  });
}

const without = (s: State) => ({ ...s, programs: [] as Program[] });

describe('importing a setup onto a device with history', () => {
  it('changes nothing recorded, adds no duplicates, and is the same when imported again', () => {
    const before = device();
    const once = importSetup(fileOf(before), before, NOW, { pauseSameNamed: false });
    const twice = importSetup(fileOf(before), once, NOW, { pauseSameNamed: false });
    expect(twice).toEqual(once);
    // Every record and every past day is exactly as it was.
    expect(without(once)).toEqual(without(before));
    for (const key of ['workoutTemplates', 'intervalRoutines', 'ruleBooks'] as const)
      expect(once[key]).toHaveLength(before[key].length);
    const ids = once.programs.flatMap((p) => p.routines.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('previews the kept history, nothing added, and no gaps for a complete setup', () => {
    const before = device();
    const preview = previewSetup(fileOf(before), before, NOW);
    expect(preview.historyKept.records).toBeGreaterThan(100);
    expect(preview.historyKept.days).toBeGreaterThan(30);
    expect(preview.plansAdded + preview.circuitsAdded + preview.rulebooksAdded).toBe(0);
    expect(preview.tradingAdded).toBe(0);
    expect(preview.routinesAdded).toEqual([]);
    expect(preview.conflicts).toEqual([]);
    expect(preview.gaps).toEqual([]);
  });

  it("keeps the device's study plan, reminders and streak start", () => {
    const before = device();
    const tuned: State = {
      ...before,
      programs: before.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) =>
          r.id === DEMO.study
            ? {
                ...r,
                study: {
                  ...r.study!,
                  at: 19 * 60,
                  reminders: { ...r.study!.reminders, start: true },
                },
              }
            : r,
        ),
      })),
    };
    const next = importSetup(fileOf(before), tuned, NOW, { pauseSameNamed: false });
    const study = next.programs.flatMap((p) => p.routines).find((r) => r.id === DEMO.study)!.study!;
    expect(study.at).toBe(19 * 60);
    expect(study.reminders.start).toBe(true);
    expect(study.trackFrom).toBe(shiftDate(TODAY, -35));
    expect(previewSetup(fileOf(before), tuned, NOW).keptOnDevice).toContain(
      'Coding practice: your study plan, reminders and streak',
    );
  });

  it('starts a study plan new from the file today, even when the file names an earlier start', () => {
    const before = device();
    const plain: State = {
      ...before,
      programs: before.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) => {
          if (r.id !== DEMO.study) return r;
          const copy = { ...r };
          delete copy.study;
          return copy;
        }),
      })),
    };
    const raw = JSON.parse(fileOf(before));
    for (const p of raw.programs)
      for (const r of p.routines)
        if (r.study)
          r.study = {
            ...r.study,
            trackFrom: '2026-01-01',
            schedule: [{ from: '2026-01-01', weekdays: [1], enabled: true }],
          };
    const next = importSetup(JSON.stringify(raw), plain, NOW, { pauseSameNamed: false });
    const study = next.programs.flatMap((p) => p.routines).find((r) => r.id === DEMO.study)!.study!;
    expect(study.trackFrom).toBe(TODAY);
    expect(study.schedule?.every((e) => e.from >= TODAY)).toBe(true);
  });

  it('keeps a paused routine paused and the rotation as set on the device', () => {
    const before = device();
    const changed: State = {
      ...before,
      programs: before.programs.map((p) => ({
        ...p,
        rotation: p.rotation && { ...p.rotation, restDays: [0, 6], startWith: DEMO.legsA },
        routines: p.routines.map((r) => (r.id === DEMO.careerStep ? { ...r, enabled: false } : r)),
      })),
    };
    const preview = previewSetup(fileOf(before), changed, NOW);
    expect(preview.keptOnDevice).toEqual(
      expect.arrayContaining([
        'Strength: your rest days and starting workout',
        'Career step: stays paused',
      ]),
    );
    const next = importSetup(fileOf(before), changed, NOW, { pauseSameNamed: false });
    const gym = next.programs.find((p) => p.id === DEMO.gym)!;
    expect(gym.rotation?.restDays).toEqual([0, 6]);
    expect(gym.rotation?.startWith).toBe(DEMO.legsA);
    expect(
      next.programs.flatMap((p) => p.routines).find((r) => r.id === DEMO.careerStep)?.enabled,
    ).toBe(false);
  });

  it('lists what a setup still needs: no days and no trading limits', () => {
    const state = device();
    const gappy: State = {
      ...state,
      programs: state.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) => (r.id === DEMO.morning ? { ...r, weekdays: [] } : r)),
      })),
      workoutTemplates: state.workoutTemplates.filter((t) => t.routineId !== DEMO.chestA),
      ruleBooks: state.ruleBooks.map((b) => ({ ...b, trading: { ...b.trading!, limits: [] } })),
    };
    expect(setupGaps(state)).toEqual([]);
    expect(setupGaps(gappy)).toEqual([
      'Morning has no days yet, so it never comes up. Set its days in Programs.',
      'Trading discipline has no limits written yet. Add yours on the Trading page.',
    ]);
  });

  it('a rotation of plain workouts without workout plans is not a gap', () => {
    const plain: State = { ...device(), workoutTemplates: [] };
    expect(plain.programs.find((p) => p.id === DEMO.gym)?.rotation?.order.length).toBeGreaterThan(
      0,
    );
    expect(setupGaps(plain)).toEqual([]);
    const preview = previewSetup(
      fileOf(plain),
      { ...without(device()), workoutTemplates: [] },
      NOW,
    );
    expect(preview.gaps).toEqual([]);
  });
});

describe('import edge cases', () => {
  const gymOf = (s: State) => s.programs.find((p) => p.id === DEMO.gym)!;

  it('reports a kept rotation only when the device really differs from the file', () => {
    const before = device();
    const raw = JSON.parse(fileOf(before));
    const gym = raw.programs.find((p: Program) => p.id === DEMO.gym);
    // The same rest days in another order, and a device with no starting workout of its own.
    gym.rotation = { ...gym.rotation, restDays: [3, 0], startWith: DEMO.legsA };
    const device2: State = {
      ...before,
      programs: before.programs.map((p) =>
        p.id === DEMO.gym ? { ...p, rotation: { ...p.rotation!, startWith: null } } : p,
      ),
    };
    const preview = previewSetup(JSON.stringify(raw), device2, NOW);
    expect(preview.keptOnDevice).toEqual([]);
    const next = importSetup(JSON.stringify(raw), device2, NOW, { pauseSameNamed: false });
    expect(gymOf(next).rotation?.startWith).toBe(DEMO.legsA);
  });

  it('remembers the days of a device workout that the file puts in the rotation', () => {
    const before = device();
    const withExtra: State = {
      ...before,
      programs: before.programs.map((p) =>
        p.id === DEMO.gym
          ? {
              ...p,
              routines: [
                ...p.routines,
                {
                  ...p.routines[0],
                  id: 'demo-arms',
                  title: 'Arms',
                  weekdays: [5],
                  checklist: false,
                },
              ],
            }
          : p,
      ),
    };
    const raw = JSON.parse(fileOf(withExtra));
    const gym = raw.programs.find((p: Program) => p.id === DEMO.gym);
    gym.rotation.order = [...gym.rotation.order, 'demo-arms'];
    const next = importSetup(JSON.stringify(raw), withExtra, NOW, { pauseSameNamed: false });
    expect(gymOf(next).rotation?.previous).toEqual([
      { routineId: 'demo-arms', weekdays: [5], checklist: false },
    ]);
    const arms = gymOf(next).routines.find((r) => r.id === 'demo-arms')!;
    expect(arms.weekdays).toEqual([]);
  });

  it('tells apart no days chosen (every day) from an empty day list (never)', () => {
    const state = device();
    const open: State = {
      ...state,
      programs: state.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) => (r.id === DEMO.morning ? { ...r, weekdays: null } : r)),
      })),
    };
    expect(setupGaps(open)).toEqual([
      'Morning has no days chosen yet, so it comes up every day. Choose its days in Programs.',
    ]);
  });

  it('offers the demo only on a device with nothing saved', () => {
    expect(isBlank(emptyState())).toBe(true);
    expect(isBlank({ ...emptyState(), measurements: device().measurements })).toBe(false);
    expect(isBlank({ ...emptyState(), days: device().days })).toBe(false);
    expect(isBlank(device())).toBe(false);
  });
});
