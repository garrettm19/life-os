// The circuit timer's countdown is sized here rather than by `adjustsFontSizeToFit`. On iOS that
// prop scales the text down inside a fixed line height and has drawn the countdown as nothing at
// all; the web ignores it and clips the time to "1:…" on a narrow screen. The countdown's digits
// are tabular, so the size that fits a width follows from the length of the text.

/** Advance of one tabular figure as a share of the font size, with a little margin. */
const GLYPH_WIDTH = 0.62;
/** The countdown's size when the time fits the width. */
export const CLOCK_MAX = 132;
/** Never smaller than this, so the time stays readable across the room. */
const CLOCK_MIN = 40;

/** The font size at which `text` fits on one line in `width` points. */
export function clockFontSize(width: number, text: string): number {
  if (!(width > 0) || !text.length) return CLOCK_MAX;
  const fits = Math.floor(width / (text.length * GLYPH_WIDTH));
  return Math.max(CLOCK_MIN, Math.min(CLOCK_MAX, fits));
}

/** A line height that holds the digits at that size. */
export function clockLineHeight(fontSize: number): number {
  return Math.round(fontSize * (150 / 132));
}
