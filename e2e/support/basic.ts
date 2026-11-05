import type { Page } from '@playwright/test';
import { basicState } from '../../src/test-support/basic-state';
import { generateDay } from '../../src/domain/planner';
import { seed } from './storage';

/** Opens `date` on the small synthetic state (four timed programs, marked as a demo), planned. */
export async function openBasic(page: Page, date: string) {
  const state = basicState();
  state.days[date] = generateDay(date, state.settings, state.programs);
  await seed(page, state, { route: '/?date=' + date });
}
