import { State } from '../domain/model';

export async function saveThenPublish(
  next: State,
  save: (state: State) => Promise<void>,
  publish: (state: State) => Promise<void>,
): Promise<void> {
  await save(next);
  // The widget is a read-only view: a slow or failed publish must never delay or fail a saved change.
  void publish(next).catch(() => {});
}
