import { beforeEach, describe, expect, it } from '@jest/globals';
import type { PlannedReminder } from '../../domain/reminders';

import {
  replaceStudyReminders,
  setStageAlert,
  setNotificationsModuleForTesting,
} from '../notifier';

// A stand-in for the native notification module: pending requests by identifier, and a permission.
type Request = { identifier: string; content: unknown; trigger: Record<string, unknown> };
const mockPending = new Map<string, Request>();
let mockGranted = true;

const mockModule = {
  SchedulableTriggerInputTypes: { DATE: 'date', WEEKLY: 'weekly' },
  getPermissionsAsync: async () => ({ granted: mockGranted, canAskAgain: !mockGranted }),
  requestPermissionsAsync: async () => ({ granted: mockGranted, canAskAgain: false }),
  getAllScheduledNotificationsAsync: async () =>
    [...mockPending.values()].map((r) => ({ identifier: r.identifier })),
  cancelScheduledNotificationAsync: async (id: string) => {
    mockPending.delete(id);
  },
  scheduleNotificationAsync: async (request: Request) => {
    mockPending.set(request.identifier, request);
    return request.identifier;
  },
};

const weeklyAt = (weekday: number, hour: number, minute = 0): PlannedReminder => ({
  id: `study:study:weekly:${weekday}`,
  title: 'Time to study',
  body: "Your study objective is on today's plan.",
  at: null,
  weekly: { weekday, hour, minute },
});

beforeEach(() => {
  setNotificationsModuleForTesting(mockModule);
  mockPending.clear();
  mockGranted = true;
});

describe('scheduling study reminders on the device', () => {
  it('schedules weekly calendar repeats with iOS weekday numbers', async () => {
    expect(await replaceStudyReminders([weeklyAt(0, 19, 30), weeklyAt(6, 19, 30)])).toBe(true);
    expect(mockPending.get('study:study:weekly:0')!.trigger).toEqual({
      type: 'weekly',
      weekday: 1,
      hour: 19,
      minute: 30,
    });
    expect(mockPending.get('study:study:weekly:6')!.trigger).toMatchObject({ weekday: 7 });
  });

  it('is idempotent, replaces a changed time, and cancels everything when turned off', async () => {
    const list = [0, 1, 2, 3, 4, 5, 6].map((d) => weeklyAt(d, 19));
    await replaceStudyReminders(list);
    await replaceStudyReminders(list);
    expect(mockPending.size).toBe(7);
    await replaceStudyReminders([0, 1, 2, 3, 4, 5, 6].map((d) => weeklyAt(d, 7, 15)));
    expect(mockPending.size).toBe(7);
    expect(mockPending.get('study:study:weekly:3')!.trigger).toMatchObject({ hour: 7, minute: 15 });
    await replaceStudyReminders([]);
    expect(mockPending.size).toBe(0);
  });

  it('removes the one-off reminders of earlier builds and never touches other notifications', async () => {
    mockPending.set('study:study:2026-11-10:start', {
      identifier: 'study:study:2026-11-10:start',
      content: {},
      trigger: { type: 'date' },
    });
    mockPending.set('another-app-feature', {
      identifier: 'another-app-feature',
      content: {},
      trigger: {},
    });
    mockPending.set('study-stage:2026-11-09:routine:study', {
      identifier: 'study-stage:2026-11-09:routine:study',
      content: {},
      trigger: { type: 'date' },
    });
    await replaceStudyReminders([weeklyAt(1, 19)]);
    expect([...mockPending.keys()].sort()).toEqual([
      'another-app-feature',
      'study-stage:2026-11-09:routine:study',
      'study:study:weekly:1',
    ]);
  });

  it('turning reminders off cancels them even while notifications are off in iOS Settings', async () => {
    await replaceStudyReminders([weeklyAt(1, 19), weeklyAt(2, 19)]);
    mockGranted = false;
    expect(await replaceStudyReminders([])).toBe(true);
    expect(mockPending.size).toBe(0);
  });

  it('schedules nothing without permission and says so, so it is retried later', async () => {
    mockGranted = false;
    expect(await replaceStudyReminders([weeklyAt(1, 19)])).toBe(false);
    expect(mockPending.size).toBe(0);
    mockGranted = true;
    expect(await replaceStudyReminders([weeklyAt(1, 19)])).toBe(true);
    expect(mockPending.size).toBe(1);
  });

  it('runs one change at a time: the newest schedule wins', async () => {
    await Promise.all([
      replaceStudyReminders([0, 1, 2, 3, 4, 5, 6].map((d) => weeklyAt(d, 19))),
      replaceStudyReminders([weeklyAt(2, 6)]),
    ]);
    expect([...mockPending.keys()]).toEqual(['study:study:weekly:2']);
    expect(mockPending.get('study:study:weekly:2')!.trigger).toMatchObject({ hour: 6 });
  });

  it('sets and clears a stage alert as a one-off', async () => {
    const alert: PlannedReminder = {
      id: 'study-stage:b1',
      title: 'Stage complete',
      body: 'Next stage',
      at: Date.UTC(2026, 10, 9, 19, 25),
      weekly: null,
    };
    await setStageAlert('b1', alert);
    expect(mockPending.get('study-stage:b1')!.trigger).toEqual({ type: 'date', date: alert.at });
    await setStageAlert('b1', null);
    expect(mockPending.has('study-stage:b1')).toBe(false);
  });

  it('reconciles the real plan idempotently: the pending count stays the same across syncs', async () => {
    const plan = [0, 1, 2, 3, 4, 5, 6].map((d) => weeklyAt(d, 19, 30));
    const evenings: PlannedReminder[] = [1, 2, 3].map((n) => ({
      id: `study:study:2099-01-0${n}:evening`,
      title: 'Study still open',
      body: 'Your study objective is still open today.',
      at: Date.UTC(2099, 0, n, 21),
      weekly: null,
    }));
    for (let sync = 0; sync < 5; sync++) await replaceStudyReminders([...plan, ...evenings]);
    expect(mockPending.size).toBe(10);
  });

  it('leaves out a one-off already due and keeps scheduling after one refused request', async () => {
    const past: PlannedReminder = {
      id: 'study:study:2020-01-01:evening',
      title: 'Study still open',
      body: 'x',
      at: Date.now() - 1000,
      weekly: null,
    };
    const original = mockModule.scheduleNotificationAsync;
    mockModule.scheduleNotificationAsync = async (request: Request) => {
      if (request.identifier.endsWith(':weekly:2')) throw new Error('refused');
      return original(request);
    };
    try {
      expect(
        await replaceStudyReminders([weeklyAt(1, 19), weeklyAt(2, 19), weeklyAt(3, 19), past]),
      ).toBe(false);
      expect([...mockPending.keys()].sort()).toEqual([
        'study:study:weekly:1',
        'study:study:weekly:3',
      ]);
    } finally {
      mockModule.scheduleNotificationAsync = original;
    }
  });
});
