import { describe, expect, it } from '@jest/globals';
import { demoState } from '../demo';
import { CATEGORIES, buildExport } from '../export';
import { todayWidgetTimeline, widgetDayStatus } from '../widget';

// Synthetic: the fictional demo, which holds a focus, a weekly review and checkpoints.
const TODAY = '2026-11-09';

describe('the focus, weekly reviews and checkpoints stay private', () => {
  const state = demoState(TODAY);
  const secrets = [
    state.focuses[0].title,
    state.focuses[0].cue,
    state.weeklyReviews[0].obstacle,
    state.weeklyReviews[0].adjustment,
    state.skillCheckpoints[0].method,
  ];

  it('never reach the widget', () => {
    const widget = JSON.stringify([
      todayWidgetTimeline(state, new Date(2026, 10, 9, 12)),
      widgetDayStatus(state, TODAY),
    ]);
    for (const text of secrets) expect(widget).not.toContain(text);
  });

  it('are not part of the selective export, even with every category and private items on', () => {
    const rows = JSON.stringify(
      buildExport(state, {
        categories: CATEGORIES.map((c) => c.key),
        from: null,
        to: TODAY,
        includePrivate: true,
      }),
    );
    for (const text of secrets) expect(rows).not.toContain(text);
  });
});
