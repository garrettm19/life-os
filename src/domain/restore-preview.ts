import { withoutInstallationChoices } from './backup';
import { State } from './model';
import { liveTradingOn } from './trading-live';

// What restoring a backup would change on this device, told truthfully before anything is
// replaced. Restore replaces the whole state (nothing is merged), so for every kind of record the
// preview counts what the backup would add, remove, or replace with different content under the
// same ID (an older backup rolls edits and completions back this way). Only labels and counts are
// shown: no weight, balance, note, title or other value from either side.

export type RestoreChange = {
  label: string;
  /** How many this device holds now. */
  current: number;
  /** In the backup, not on this device. */
  added: number;
  /** On this device, not in the backup. */
  removed: number;
  /** On both, with different content: the backup's version replaces this device's. */
  replaced: number;
};

export type RestorePreview = {
  /** Kinds of record that would change, in a fixed order; kinds that would not change are left out. */
  changes: RestoreChange[];
  /** The schedule and other settings in the backup differ from this device's. */
  settingsChanged: boolean;
  /** The setup notes differ. */
  notesChanged: boolean;
  /** The Home Screen day status is on here; backups never carry it, so restoring turns it off. */
  widgetTurnsOff: boolean;
  /** Live trading is on here; backups never carry it, so restoring turns it off. */
  liveTurnsOff: boolean;
  /** Nothing would change: the backup holds exactly this device's data. */
  unchanged: boolean;
};

/** The record lists, each with the plural label the preview shows for it. */
const RECORD_LABELS = [
  ['measurements', 'weights'],
  ['workoutSessions', 'workout logs'],
  ['workoutTemplates', 'workout plans'],
  ['moneyReviews', 'money reviews'],
  ['lifeLog', 'log entries'],
  ['intervalSessions', 'circuit sessions'],
  ['intervalRoutines', 'timed circuits'],
  ['activitySessions', 'activities'],
  ['ruleReviews', 'rule reviews'],
  ['ruleBooks', 'rulebooks'],
  ['focuses', 'focus periods'],
  ['weeklyReviews', 'weekly reviews'],
  ['skillCheckpoints', 'skill checkpoints'],
] as const;

/** JSON with object keys in sorted order, so equal records compare equal whatever their key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function compare<T>(
  label: string,
  current: Map<string, T>,
  incoming: Map<string, T>,
): RestoreChange {
  let removed = 0;
  let replaced = 0;
  for (const [key, record] of current) {
    const other = incoming.get(key);
    if (other === undefined) removed++;
    else if (canonical(record) !== canonical(other)) replaced++;
  }
  let added = 0;
  for (const key of incoming.keys()) if (!current.has(key)) added++;
  return { label, current: current.size, added, removed, replaced };
}

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((r) => [r.id, r]));

export function restorePreview(device: State, backup: State): RestorePreview {
  // The widget opt-in, the live trading switch and the time of the last export belong to this
  // installation and are never in a backup, so none of them counts as a difference.
  const current = withoutInstallationChoices(device);
  const incoming = withoutInstallationChoices(backup);
  const all: RestoreChange[] = [
    compare('goals', byId(current.goals), byId(incoming.goals)),
    compare('programs', byId(current.programs), byId(incoming.programs)),
    compare(
      'planned days',
      new Map(Object.entries(current.days)),
      new Map(Object.entries(incoming.days)),
    ),
    compare(
      'trading sessions',
      new Map(Object.entries(current.tradingSessions)),
      new Map(Object.entries(incoming.tradingSessions)),
    ),
    ...RECORD_LABELS.map(([key, label]) =>
      compare(label, byId<{ id: string }>(current[key]), byId<{ id: string }>(incoming[key])),
    ),
  ];
  const changes = all.filter((c) => c.added + c.removed + c.replaced > 0);
  const settingsChanged = canonical(current.settings) !== canonical(incoming.settings);
  const notesChanged = canonical(current.notes) !== canonical(incoming.notes);
  return {
    changes,
    settingsChanged,
    notesChanged,
    widgetTurnsOff: device.settings.widgetDayStatus === true,
    liveTurnsOff: device.ruleBooks.some((b) => b.trading !== undefined && liveTradingOn(b.trading)),
    unchanged: !changes.length && !settingsChanged && !notesChanged,
  };
}

/** One plain sentence per kind of record, counts only. */
export function changeLine(change: RestoreChange): string {
  const parts = [
    change.replaced ? `${change.replaced} replaced by the backup's version` : '',
    change.removed ? `${change.removed} removed` : '',
    change.added ? `${change.added} added from the backup` : '',
  ].filter(Boolean);
  return `${change.label}: ${parts.join(', ')} (you have ${change.current})`;
}
