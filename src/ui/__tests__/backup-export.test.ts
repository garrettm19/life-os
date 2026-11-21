// A .ts test has no JSX, and createElement's typing needs children among the props.
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { MAX_BACKUP_BYTES, encodeBackup } from '../../domain/backup';
import { State, emptyState } from '../../domain/model';
import { measureBackup, measuredBackupBytes } from '../backup-size';
import { useBackupExport } from '../use-backup-export';

// Exports are held open until a test settles them, so a second tap lands mid-export.
const mockExport = {
  calls: 0,
  settle: [] as ((r: { notice: string; confirmed: boolean }) => void)[],
};
jest.mock('../../data/export-backup', () => ({
  exportBackup: () => {
    mockExport.calls++;
    return new Promise((resolve) => mockExport.settle.push(resolve));
  },
}));
const mockChanges: unknown[] = [];
jest.mock('../../state/app-state', () => ({
  useApp: () => ({
    state: {
      ...jest.requireActual<typeof import('../../domain/model')>('../../domain/model').emptyState(),
      source: 'personal',
    },
    change: async (operation: unknown) => {
      mockChanges.push(operation);
      return true;
    },
    clearError: () => {},
  }),
}));

afterEach(() => {
  mockExport.calls = 0;
  mockExport.settle.length = 0;
  mockChanges.length = 0;
});

type Hook = ReturnType<typeof useBackupExport>;
function mount(): { current: () => Hook } {
  let hook: Hook | null = null;
  function Probe() {
    hook = useBackupExport();
    return null;
  }
  act(() => {
    create(createElement(Probe));
  });
  return { current: () => hook! };
}

describe('exporting a backup', () => {
  it('starts one export at a time: a second tap while one is open does nothing', async () => {
    const hook = mount();
    await act(async () => {
      void hook.current().save();
      void hook.current().save();
    });
    expect(mockExport.calls).toBe(1);
    await act(async () => mockExport.settle[0]({ notice: 'closed', confirmed: false }));
    // Unconfirmed: nothing is recorded until Saved it.
    expect(mockChanges).toHaveLength(0);
    expect(hook.current().unconfirmed).toBe(true);
    await act(async () => {
      await hook.current().confirmSaved();
    });
    expect(mockChanges).toHaveLength(1);
  });
});

describe('measuring the backup size', () => {
  it('measures a backup over the limit without throwing; export still refuses it', () => {
    const big: State = {
      ...emptyState(),
      source: 'personal',
      notes: ['x'.repeat(MAX_BACKUP_BYTES + 10)],
    };
    expect(() => measureBackup(big)).not.toThrow();
    expect(measuredBackupBytes()!).toBeGreaterThan(MAX_BACKUP_BYTES);
    expect(() => encodeBackup(big)).toThrow(/20 MB backup limit/);
  });

  it('measures nothing, and never throws, for a state a backup would refuse', () => {
    const bad = { ...emptyState(), settings: { ...emptyState().settings, wake: 2000 } } as State;
    expect(() => measureBackup(bad)).not.toThrow();
    expect(measureBackup(bad)).toBeNull();
  });
});
