/** Words kept as written when a status title is put in sentence case. */
const KEEP: [RegExp, string][] = [
  [/\bhtf\b/g, 'HTF'],
  [/\bgex\b/g, 'GEX'],
  [/\bnew york\b/g, 'New York'],
  [/\bi'm\b/g, "I'm"],
];

/**
 * A cockpit status title (`tradeStatus().title`, in capitals for the cockpit's band) in sentence
 * case, for a place that is not the band, such as Today's row: "NO TRADE — HTF UNCLEAR" reads
 * "No trade — HTF unclear". Only the letters' case changes; the words are the status's own. A
 * time keeps its AM or PM, joined to it so a wrapped caption never splits the time.
 */
export function statusWords(title: string): string {
  let words = title.toLowerCase();
  for (const [pattern, kept] of KEEP) words = words.replace(pattern, kept);
  words = words.replace(
    /\b(\d{1,2}:\d{2}) (am|pm)\b/g,
    (_, clock: string, period: string) => `${clock}\u00a0${period.toUpperCase()}`,
  );
  return words.charAt(0).toUpperCase() + words.slice(1);
}
