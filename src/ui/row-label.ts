type Status = 'planned' | 'done' | 'skipped';

function spokenStatus(status: Status): string {
  if (status === 'done') return 'Completed';
  if (status === 'skipped') return 'Skipped';
  return 'Not completed';
}

/**
 * What VoiceOver hears for an objective row's edit button: the action, then the same status line
 * the eye reads under the title (Now, Up next, a time, Done at …). The button's own label would
 * otherwise hide that line.
 */
export function rowLabel(action: string, status: Status, sub?: string | null): string {
  const detail = sub
    ? sub.replace(/ · /g, ', ').replace(/\s?–\u2060?\s?/g, ' to ')
    : status === 'planned'
      ? null
      : spokenStatus(status);
  return detail ? `${action}. ${detail}` : action;
}

/**
 * The hint for a checklist row that ticks on tap: what the tap does in this status (it toggles, so
 * on a done or skipped row it reopens the item), then how to reach the editor.
 */
export function tickHint(status: Status): string {
  const result =
    status === 'planned'
      ? 'Marks it done.'
      : status === 'done'
        ? 'Marks it not done.'
        : 'Reopens it.';
  return `${result} Long press to edit.`;
}

/**
 * The short note on a row's instructions toggle: its steps ("3 steps"), or its links when it has
 * no steps. Both show once it is open. Null when there is nothing to fold.
 */
export function instructionsCaption(steps: number, links: number): string | null {
  if (steps) return `${steps} step${steps === 1 ? '' : 's'}`;
  if (links) return `${links} link${links === 1 ? '' : 's'}`;
  return null;
}
