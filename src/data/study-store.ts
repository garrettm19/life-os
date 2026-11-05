import Storage from 'expo-sqlite/kv-store';
import { StudyRun, decodeStudyRun } from '../domain/study';
import { STUDY_PREFIX } from '../state/session-store';

// The study session in progress, kept on this device only so an interruption (a call, leaving for
// another app, the app being closed) never loses work. It is not part of the plan or of backups:
// only a confirmed session becomes a record. Reset and restore clear it with the circuit slots.
const key = (blockId: string) => `${STUDY_PREFIX}${blockId}`;

export async function loadStudyRun(blockId: string): Promise<StudyRun | null> {
  try {
    const raw = await Storage.getItemAsync(key(blockId));
    const saved = raw ? decodeStudyRun(JSON.parse(raw)) : null;
    return saved?.blockId === blockId ? saved : null;
  } catch {
    return null;
  }
}

export async function saveStudyRun(blockId: string, run: StudyRun | null): Promise<void> {
  if (run) await Storage.setItemAsync(key(blockId), JSON.stringify(run));
  else await Storage.removeItemAsync(key(blockId));
}
