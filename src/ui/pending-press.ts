import { useCallback, useState } from 'react';

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | null)?.then === 'function';

/**
 * Runs a press that may save. While the promise it returns is pending, and `status` is still what
 * it was when pressed, `pending` is true: a check can show its press at once without claiming the
 * saved result. The saved status replaces it when the save lands; a refused save shows the saved
 * status again. A press that saves nothing (it opens a screen) returns no promise and shows no
 * pending look.
 */
export function usePendingPress<S>(status: S) {
  const [from, setFrom] = useState<{ status: S } | null>(null);
  const run = useCallback(
    (press: () => unknown) => {
      const result = press();
      if (!isThenable(result)) return;
      const token = { status };
      setFrom(token);
      const settle = () => setFrom((current) => (current === token ? null : current));
      result.then(settle, settle);
    },
    [status],
  );
  return { pending: from !== null && from.status === status, run };
}
