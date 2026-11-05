import { describe, expect, it } from '@jest/globals';
import { withDay } from '../data';
import { basicState } from '../../test-support/basic-state';
import { Routine, State } from '../model';
import { dayProgress } from '../objectives';
import { ensureChecklistDay, setStatus } from '../planner';
import { ensureDay } from '../rotation';
import { importSetup, previewSetup } from '../setup';
import { trainingState } from '../../test-support/fixtures';

// Synthetic setup files only.
const MON = '2026-11-09';
const AT = new Date(2026, 10, 9, 12).toISOString();

const routine = (id: string, title: string, extra: Partial<Routine> = {}): Routine => ({
  id,
  title,
  duration: null,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  preferredStart: null,
  enabled: true,
  fixed: false,
  steps: [],
  bundledInto: null,
  checklist: true,
  ...extra,
});

const file = () =>
  JSON.stringify({
    format: 'life-os-setup-v1',
    goals: [],
    programs: [
      {
        id: 'pack-daily',
        title: 'Daily',
        group: 'Daily',
        goalIds: [],
        routines: [
          routine('pack-reset', 'Morning reset'),
          routine('pack-weigh', 'Morning weigh-in', {
            optional: true,
            capture: 'weight',
            private: true,
          }),
        ],
      },
      {
        id: 'pack-gym',
        title: 'Gym',
        group: 'Training',
        goalIds: [],
        routines: [
          routine('pack-a', 'Workout A', { weekdays: [] }),
          routine('pack-b', 'Workout B', { weekdays: [] }),
          routine('pack-neck', 'Neck routine', { weekdays: [], follows: ['pack-a'] }),
        ],
        rotation: { order: ['pack-a', 'pack-b'], restDays: [0], startWith: null },
      },
    ],
  });

/** The device already has its own "Morning reset" with a different ID, and some history. */
function device(): State {
  let s = trainingState();
  s = {
    ...s,
    notes: ['Mine'],
    programs: [
      ...s.programs,
      {
        id: 'mine',
        title: 'My habits',
        group: 'Daily',
        goalIds: [],
        routines: [routine('my-reset', 'Morning Reset ')],
      },
    ],
  };
  s = withDay(
    s,
    ensureChecklistDay(
      '2026-11-08',
      s.settings,
      s.programs,
      undefined,
      new Date(2026, 10, 8, 12).toISOString(),
    ),
  );
  return withDay(
    s,
    setStatus(
      s.days['2026-11-08'],
      '2026-11-08:routine:my-reset',
      'done',
      new Date(2026, 10, 8, 12).toISOString(),
    ),
  );
}

describe('setup import preview and conflicts', () => {
  it('previews exactly what an import adds, keeps settings and notes, and finds same-named routines', () => {
    const preview = previewSetup(file(), device(), AT);
    expect(preview.programsAdded).toEqual(['Daily', 'Gym']);
    expect(preview.routinesAdded).toEqual([
      'Morning reset',
      'Morning weigh-in',
      'Workout A',
      'Workout B',
      'Neck routine',
    ]);
    expect(preview.optionalRoutines).toEqual(['Morning weigh-in']);
    expect(preview.settingsReplaced).toBe(false);
    expect(preview.notesReplaced).toBe(false);
    expect(preview.conflicts).toEqual([
      {
        title: 'Morning reset',
        existing: { id: 'my-reset', program: 'My habits' },
        incoming: { id: 'pack-reset', program: 'Daily' },
      },
    ]);
  });

  it('importing the same file twice changes nothing the second time and creates no duplicates', () => {
    const once = importSetup(file(), device(), AT, { pauseSameNamed: false });
    const preview = previewSetup(file(), once, AT);
    expect(preview.programsAdded).toEqual([]);
    expect(preview.programsUnchanged).toEqual(['Daily', 'Gym']);
    expect(preview.routinesAdded).toEqual([]);
    const twice = importSetup(file(), once, AT, { pauseSameNamed: false });
    expect(twice.programs).toEqual(once.programs);
    expect(twice.notes).toEqual(['Mine']);
  });

  it('pausing same-named routines keeps their history; keeping both leaves them active', () => {
    const before = device();
    const paused = importSetup(file(), before, AT, { pauseSameNamed: true });
    const mine = paused.programs.find((p) => p.id === 'mine')!.routines[0];
    expect(mine.enabled).toBe(false);
    expect(paused.days['2026-11-08']).toEqual(before.days['2026-11-08']);
    const both = importSetup(file(), before, AT, { pauseSameNamed: false });
    expect(both.programs.find((p) => p.id === 'mine')!.routines[0].enabled).toBe(true);
  });

  it('an imported optional routine never blocks Day Cleared, and a companion appears only with its workout', () => {
    let s = importSetup(file(), device(), AT, { pauseSameNamed: true });
    s = ensureDay(s, MON, AT);
    const day = s.days[MON];
    expect(day.blocks.find((b) => b.routineId === 'pack-weigh')!.optional).toBe(true);
    // Monday is a training day: Workout A and its companion.
    expect(
      day.blocks
        .filter((b) => b.routineId?.startsWith('pack-'))
        .map((b) => b.routineId)
        .sort(),
    ).toEqual(['pack-a', 'pack-neck', 'pack-reset', 'pack-weigh']);
    // Done with everything required, the optional weigh-in left open: the day is cleared.
    for (const b of day.blocks.filter((x) => !x.optional))
      s = withDay(s, setStatus(s.days[MON], b.id, 'done', AT));
    expect(dayProgress(s.days[MON], s.programs, MON).cleared).toBe(true);
    // Sunday rests: no workout, so no companion.
    const sun = '2026-11-15';
    s = ensureDay(s, sun, new Date(2026, 10, 15, 12).toISOString());
    expect(s.days[sun].blocks.some((b) => b.routineId === 'pack-neck')).toBe(false);
  });
});

describe('setup import over the demo', () => {
  it('previews and imports as onto an empty plan, even with demo-named routines', () => {
    const demo = basicState();
    const raw = JSON.stringify({
      format: 'life-os-setup-v1',
      goals: [],
      programs: [
        {
          id: 'pack',
          title: 'Pack',
          group: 'Daily',
          goalIds: [],
          // Named like a demo routine.
          routines: [routine('pack-morning', demo.programs[0].routines[0].title)],
        },
      ],
    });
    const preview = previewSetup(raw, demo, AT);
    expect(preview.conflicts).toEqual([]);
    expect(preview.programsAdded).toEqual(['Pack']);
    expect(preview.plansAdded).toBe(0);
    expect(preview.recordsKept).toEqual({ plans: 0, circuits: 0, rulebooks: 0 });
    const result = importSetup(raw, demo, AT, { pauseSameNamed: true });
    expect(result.source).toBe('personal');
    expect(result.programs.map((p) => p.id)).toEqual(['pack']);
  });

  it("keeps the device's widget opt-in and timer cue, with or without settings in the file", () => {
    const demo: State = {
      ...basicState(),
      settings: {
        ...basicState().settings,
        wake: 5 * 60,
        widgetDayStatus: true,
        timerCue: 'mute',
        lastBackupAt: AT,
      },
    };
    const programs = [{ id: 'pack', title: 'Pack', group: 'Daily', goalIds: [], routines: [] }];
    const bare = JSON.stringify({ format: 'life-os-setup-v1', goals: [], programs });
    const withSettings = JSON.stringify({
      format: 'life-os-setup-v1',
      goals: [],
      programs,
      settings: { ...basicState().settings, wake: 6 * 60, widgetDayStatus: false },
    });
    for (const raw of [bare, withSettings]) {
      const next = importSetup(raw, demo, AT, { pauseSameNamed: false });
      expect(next.settings.widgetDayStatus).toBe(true);
      expect(next.settings.timerCue).toBe('mute');
      // A backup of the demo holds none of the imported setup.
      expect(next.settings.lastBackupAt).toBeUndefined();
    }
    // Nothing else of the demo's settings is kept: the file's apply, or the defaults.
    expect(importSetup(bare, demo, AT, { pauseSameNamed: false }).settings.wake).not.toBe(5 * 60);
    expect(importSetup(withSettings, demo, AT, { pauseSameNamed: false }).settings.wake).toBe(
      6 * 60,
    );
    expect(previewSetup(bare, demo, AT).settingsReplaced).toBe(false);
  });

  it('keeps the same device choices over the demo as over a personal device', () => {
    const settings = {
      ...basicState().settings,
      widgetDayStatus: true,
      timerCue: 'mute' as const,
      lastBackupAt: AT,
    };
    const personal: State = { ...basicState(), source: 'personal', settings };
    const demo: State = { ...personal, source: 'demo' };
    const raw = JSON.stringify({
      format: 'life-os-setup-v1',
      goals: [],
      programs: [{ id: 'pack', title: 'Pack', group: 'Daily', goalIds: [], routines: [] }],
      settings: {
        ...basicState().settings,
        wake: 6 * 60,
        widgetDayStatus: false,
        timerCue: 'voice',
      },
    });
    const overPersonal = importSetup(raw, personal, AT, { pauseSameNamed: false }).settings;
    const overDemo = importSetup(raw, demo, AT, { pauseSameNamed: false }).settings;
    // Only the last backup time differs: a backup of the demo holds none of the imported setup.
    expect(overPersonal.lastBackupAt).toBe(AT);
    expect(overDemo).toEqual({ ...overPersonal, lastBackupAt: undefined });
    expect(overDemo).not.toHaveProperty('lastBackupAt');
  });
});
