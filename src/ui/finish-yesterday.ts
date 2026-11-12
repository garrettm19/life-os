/**
 * Dates whose Finish yesterday line was closed. Kept for this run of the app only, never saved: it
 * survives switching tabs and backgrounding, and a cold launch offers the line again while
 * yesterday can still be finished.
 */
const dismissed = new Set<string>();

export function finishDismissed(date: string): boolean {
  return dismissed.has(date);
}

export function dismissFinish(date: string): void {
  dismissed.add(date);
}
