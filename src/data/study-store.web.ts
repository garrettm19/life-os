import { StudyRun, decodeStudyRun } from '../domain/study';
import { STUDY_PREFIX } from '../state/session-store';

// Browser preview: the study session in progress lives in localStorage, beside the plan.
const key = (blockId: string) => `${STUDY_PREFIX}${blockId}`;

export async function loadStudyRun(blockId: string): Promise<StudyRun | null> {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(key(blockId));
    const saved = raw ? decodeStudyRun(JSON.parse(raw)) : null;
    return saved?.blockId === blockId ? saved : null;
  } catch {
    return null;
  }
}

export async function saveStudyRun(blockId: string, run: StudyRun | null): Promise<void> {
  if (typeof window === 'undefined') return;
  if (run) window.localStorage.setItem(key(blockId), JSON.stringify(run));
  else window.localStorage.removeItem(key(blockId));
}
