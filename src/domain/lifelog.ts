import { LifeLogEntry, LogCategory, State, dateObject } from './model';
import { validateLifeLog } from './records';

export type LogInput = {
  text: string;
  date: string;
  category: LogCategory | null;
  energy: number | null;
  mood: number | null;
  goalId: string | null;
};

export const CATEGORY_LABELS: Record<LogCategory, string> = {
  general: 'General',
  health: 'Health and energy',
  training: 'Training',
  career: 'Career',
  money: 'Finances',
  social: 'Social life',
  learning: 'Learning',
  reflection: 'Reflection',
};

/** Adds a note, or replaces one entry by ID. Other entries are never touched. */
export function saveLog(
  state: State,
  input: LogInput,
  id: string,
  at: string,
  existingId?: string,
): State {
  dateObject(input.date);
  const text = input.text.trim();
  if (!text) throw new Error('Write a few words first.');
  const existing = existingId ? state.lifeLog.find((e) => e.id === existingId) : undefined;
  if (existingId && !existing) throw new Error('This entry no longer exists.');
  const entry: LifeLogEntry = {
    id: existing?.id ?? id,
    date: input.date,
    // The original time stays: an edit corrects the entry, it does not re-date it.
    at: existing?.at ?? at,
    text,
    category: input.category,
    energy: input.energy,
    mood: input.mood,
    goalId: input.goalId,
  };
  const lifeLog = existing
    ? state.lifeLog.map((e) => (e.id === existing.id ? entry : e))
    : [...state.lifeLog, entry];
  validateLifeLog(lifeLog);
  return { ...state, lifeLog };
}

export function deleteLog(state: State, id: string): State {
  if (!state.lifeLog.some((e) => e.id === id)) throw new Error('This entry no longer exists.');
  return { ...state, lifeLog: state.lifeLog.filter((e) => e.id !== id) };
}

/** Entries for one date, oldest first. A date without entries simply has none. */
export function logFor(state: State, date: string): LifeLogEntry[] {
  return state.lifeLog.filter((e) => e.date === date).sort((a, b) => a.at.localeCompare(b.at));
}

/** Most recent entries first, for Progress. */
export function recentLog(state: State, limit: number): LifeLogEntry[] {
  return [...state.lifeLog]
    .sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at))
    .slice(0, limit);
}
