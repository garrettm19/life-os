/**
 * A whole number typed into a form: null when the text is blank, NaN when it is not digits only
 * (all the number pad can type). Each form checks the range and writes its own message.
 */
export function parseWhole(text: string): number | null {
  const plain = text.trim();
  if (!plain) return null;
  return /^\d+$/.test(plain) ? Number(plain) : NaN;
}
