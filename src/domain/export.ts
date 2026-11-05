import { State, localDate } from './model';
import { dayOutcome, objectiveLeaves } from './objectives';
import { fromGrams } from './records';
import { ruleBookFor } from './rules';
import { processScore, sessionResult } from './trading';
import { exerciseOptions, strengthSeries } from './series';
import { fullStudy } from './study';

// Selective export for the user's own analysis, in a spreadsheet or another tool they choose.
// Separate from backups: it never restores, carries only the categories and dates the user picks,
// and leaves sensitive categories and private objectives out unless explicitly chosen. Every value
// is one row: category, date, item, field, value, unit, note. Missing values are explicit: a blank
// field is "not reported", never zero; days without a record have no row and are said to be absent.

export const EXPORT_FORMAT = 'life-os-analysis-export';
export const EXPORT_VERSION = 1;

export type ExportCategory =
  | 'workouts'
  | 'strength'
  | 'weight'
  | 'money'
  | 'objectives'
  | 'activities'
  | 'circuits'
  | 'lifeLog'
  | 'ruleReviews';

export const CATEGORIES: {
  key: ExportCategory;
  label: string;
  description: string;
  /** Sensitive categories are never selected by default and show a warning. */
  sensitive: boolean;
}[] = [
  {
    key: 'workouts',
    label: 'Workout sets',
    description: 'Every logged working set',
    sensitive: false,
  },
  {
    key: 'strength',
    label: 'Exercise progress',
    description: 'Heaviest set per finished workout, per exercise',
    sensitive: false,
  },
  {
    key: 'weight',
    label: 'Body weight',
    description: 'Measured weights with units',
    sensitive: false,
  },
  {
    key: 'money',
    label: 'Money totals',
    description: 'Cash, savings and debt as reported',
    sensitive: false,
  },
  {
    key: 'objectives',
    label: 'Objective adherence',
    description: 'Done, skipped or open per objective and day',
    sensitive: false,
  },
  {
    key: 'activities',
    label: 'Activities',
    description: 'Activity type and minutes, and study stage times',
    sensitive: false,
  },
  { key: 'circuits', label: 'Timed circuits', description: 'Completed circuits', sensitive: false },
  {
    key: 'lifeLog',
    label: 'Life log',
    description: 'Your private notes and ratings',
    sensitive: true,
  },
  {
    key: 'ruleReviews',
    label: 'Rule reviews',
    description: 'Checkpoint answers and broken rules',
    sensitive: true,
  },
];

export type ExportOptions = {
  categories: ExportCategory[];
  /** First date included, or null for all history. */
  from: string | null;
  to: string;
  /** Objectives marked private are left out of adherence unless this is on. */
  includePrivate: boolean;
};

export type ExportRow = {
  category: ExportCategory;
  date: string;
  item: string;
  field: string;
  value: string | number | null;
  unit: string;
  note: string;
};

const inRange = (date: string, o: ExportOptions) =>
  (o.from === null || date >= o.from) && date <= o.to;

/** Records of a private routine stay out unless private items are explicitly included. */
function hidden(state: State, routineId: string | null, o: ExportOptions): boolean {
  if (o.includePrivate || !routineId) return false;
  return state.programs.some((p) => p.routines.some((r) => r.id === routineId && r.private));
}

/** Categories that can hold records of private routines. */
export const PRIVATE_AWARE: ExportCategory[] = [
  'workouts',
  'strength',
  'objectives',
  'activities',
  'circuits',
  'ruleReviews',
];

function rowsFor(state: State, category: ExportCategory, o: ExportOptions): ExportRow[] {
  const rows: ExportRow[] = [];
  const add = (
    date: string,
    item: string,
    field: string,
    value: ExportRow['value'],
    unit = '',
    note = '',
  ) => rows.push({ category, date, item, field, value, unit, note });
  if (category === 'workouts')
    for (const s of state.workoutSessions) {
      if (s.status !== 'completed' || !inRange(s.date, o) || hidden(state, s.routineId, o))
        continue;
      const title = state.workoutTemplates.find((t) => t.id === s.templateId)?.title ?? 'Workout';
      for (const e of s.exercises) {
        const note = e.substitutedFor ? `instead of ${e.substitutedFor.name}` : '';
        e.sets
          .filter((set) => set.done)
          .forEach((set, i) => {
            const item = `${title} / ${e.name}`;
            if (e.kind === 'time')
              add(s.date, item, `set ${i + 1} time`, set.seconds ?? null, 's', note);
            else {
              add(
                s.date,
                item,
                `set ${i + 1} load`,
                set.load,
                set.load === null ? '' : e.unit,
                note,
              );
              add(s.date, item, `set ${i + 1} reps`, set.reps, 'reps', note);
            }
          });
      }
    }
  if (category === 'strength') {
    // Sessions of private routines stay out unless private routines are included.
    const visible: State = {
      ...state,
      workoutSessions: state.workoutSessions.filter((s) => !hidden(state, s.routineId, o)),
    };
    for (const option of exerciseOptions(visible))
      for (const p of strengthSeries(visible, option.key, 'all', o.to)) {
        if (!inRange(p.date, o)) continue;
        add(p.date, option.name, 'heaviest set load', p.load, p.load === null ? '' : option.unit);
        add(p.date, option.name, 'reps of that set', p.reps, 'reps');
      }
  }
  if (category === 'weight')
    for (const m of [...state.measurements].sort((a, b) => a.date.localeCompare(b.date))) {
      if (m.kind !== 'body-weight' || !inRange(m.date, o)) continue;
      const fasted = m.fasted === null ? 'fasted not recorded' : m.fasted ? 'fasted' : 'not fasted';
      add(m.date, 'body weight', 'weight', m.entered.value, m.entered.unit, fasted);
      // The same weight in the other unit, converted from the stored grams.
      const other = m.entered.unit === 'lb' ? 'kg' : 'lb';
      add(
        m.date,
        'body weight',
        `weight in ${other}`,
        fromGrams(m.grams, other),
        other,
        'converted',
      );
    }
  if (category === 'money')
    for (const r of [...state.moneyReviews].sort((a, b) => a.date.localeCompare(b.date))) {
      if (!inRange(r.date, o)) continue;
      for (const field of ['cash', 'savings', 'debt'] as const)
        add(
          r.date,
          'money review',
          field,
          r[field] === null ? null : r[field]! / 100,
          r.currency,
          r[field] === null ? 'not reported' : '',
        );
    }
  if (category === 'objectives')
    for (const date of Object.keys(state.days).sort()) {
      if (!inRange(date, o)) continue;
      for (const leaf of objectiveLeaves(state.days[date], state.programs)) {
        if (leaf.private && !o.includePrivate) continue;
        add(date, leaf.title, 'status', leaf.status, '', leaf.optional ? 'optional' : '');
      }
      add(
        date,
        'day',
        'outcome',
        dayOutcome(state, date),
        '',
        'counts every objective, private ones included',
      );
    }
  if (category === 'activities')
    for (const a of state.activitySessions) {
      if (!inRange(a.date, o) || hidden(state, a.routineId, o)) continue;
      if (!a.study) {
        add(a.date, a.activity, 'minutes', a.minutes, 'min', a.note);
        continue;
      }
      // A study session: its whole minutes, then what each stage actually ran against its plan.
      add(
        a.date,
        a.activity,
        'study minutes',
        a.minutes,
        'min',
        fullStudy(a.study) ? 'full session' : 'shorter than planned',
      );
      for (const stage of a.study.stages)
        add(
          a.date,
          `${a.activity} · ${stage.title}`,
          'stage time',
          stage.seconds,
          's',
          `planned ${stage.plannedSeconds} s${stage.done ? '' : ' · not finished'}`,
        );
    }
  if (category === 'circuits')
    for (const s of state.intervalSessions) {
      if (!inRange(s.date, o) || hidden(state, s.routineId, o)) continue;
      const title = state.intervalRoutines.find((c) => c.id === s.intervalId)?.title ?? 'Circuit';
      add(
        s.date,
        title,
        'planned length',
        s.plannedSeconds,
        's',
        s.skipped.length ? `skipped: ${s.skipped.join(', ')}` : 'complete',
      );
    }
  if (category === 'lifeLog')
    for (const e of state.lifeLog) {
      if (!inRange(e.date, o)) continue;
      add(e.date, e.category ?? 'note', 'text', e.text);
      add(
        e.date,
        e.category ?? 'note',
        'energy',
        e.energy,
        '1-5 self-report',
        e.energy === null ? 'not given' : '',
      );
      add(
        e.date,
        e.category ?? 'note',
        'mood',
        e.mood,
        '1-5 self-report',
        e.mood === null ? 'not given' : '',
      );
    }
  if (category === 'ruleReviews')
    for (const r of state.ruleReviews) {
      if (!inRange(r.date, o) || hidden(state, r.routineId, o)) continue;
      const book = ruleBookFor(state, r.routineId);
      // A trading review: its session, the process score and result, PASS/FAIL per item and the
      // hard violations, named from its own process. No money figure exists to export.
      if (r.trading && book?.trading) {
        const profile = book.trading;
        const label = book.title;
        add(
          r.date,
          label,
          'session',
          r.trading.session === 'away' ? 'day away' : r.trading.session,
        );
        if (r.trading.session !== 'away') {
          add(r.date, label, 'process score', processScore(r, profile).passed, 'of 8');
          add(
            r.date,
            label,
            'result',
            sessionResult(r, profile) === 'clean' ? 'clean' : 'rule-broken',
          );
          for (const a of r.answers)
            add(
              r.date,
              profile.checklist.find((c) => c.id === a.checkpointId)?.title ?? a.checkpointId,
              'process item',
              a.answer === 'yes' ? 'pass' : 'fail',
            );
          for (const v of r.violations)
            add(
              r.date,
              profile.violations.find((x) => x.id === v)?.title ?? v,
              'hard violation',
              'yes',
            );
          if (r.trading.entries !== null)
            add(r.date, label, 'entries', r.trading.entries, '', 'self-reported');
          if (r.trading.failedTheses !== null)
            add(r.date, label, 'failed theses', r.trading.failedTheses, '', 'self-reported');
        }
        continue;
      }
      add(
        r.date,
        book?.title ?? 'rules',
        'outcome',
        r.outcome === 'none' ? 'no activity' : 'reviewed',
      );
      for (const a of r.answers)
        add(
          r.date,
          book?.checkpoints.find((c) => c.id === a.checkpointId)?.text ?? a.checkpointId,
          'answer',
          a.answer === 'na' ? 'not applicable' : a.answer,
        );
      for (const v of r.violations)
        add(r.date, book?.rules.find((x) => x.id === v)?.title ?? v, 'broken rule', 'yes');
    }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** Rows for the chosen categories, category by category. */
export function buildExport(state: State, options: ExportOptions): ExportRow[] {
  return CATEGORIES.filter((c) => options.categories.includes(c.key)).flatMap((c) =>
    rowsFor(state, c.key, options),
  );
}

const NOTES =
  'One row per value. Dates are local calendar dates (YYYY-MM-DD). A null or empty value with the ' +
  'note "not reported" or "not given" was left blank by the user; it is not zero. Days without a ' +
  'record have no rows: absent is missing, not zero. Weights are as entered, with a converted ' +
  'row in the other unit. Money is in the stated currency, as reported balances, not ' +
  'transactions. Self-ratings are self-reports, not measurements.';

export function encodeJson(
  state: State,
  options: ExportOptions,
  generatedAt = new Date().toISOString(),
): string {
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      generatedAt,
      range: { from: options.from, to: options.to },
      categories: options.categories,
      includesPrivateObjectives:
        options.categories.includes('objectives') && options.includePrivate,
      notes: NOTES,
      columns: ['category', 'date', 'item', 'field', 'value', 'unit', 'note'],
      rows: buildExport(state, options),
    },
    null,
    2,
  );
}

function cell(value: string | number | null): string {
  if (value === null) return '';
  // A leading = + - @, tab or carriage return would make a spreadsheet evaluate user text as a
  // formula, so such text is written with a leading apostrophe.
  const raw = String(value);
  const text = typeof value === 'string' && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function encodeCsv(state: State, options: ExportOptions): string {
  const header = 'category,date,item,field,value,unit,note';
  const lines = buildExport(state, options).map((r) =>
    [r.category, r.date, r.item, r.field, r.value, r.unit, r.note].map(cell).join(','),
  );
  return [header, ...lines].join('\n') + '\n';
}

/** A file name with the export date, never the user's data. */
export function exportName(format: 'json' | 'csv', today = localDate()): string {
  return `LifeOS-analysis-${today}.${format}`;
}
