import { describe, expect, it } from '@jest/globals';
import { CLOCK_MAX, clockFontSize, clockLineHeight } from '../clock-size';

describe('clockFontSize', () => {
  it('keeps the full size while the time fits', () => {
    expect(clockFontSize(350, '1:10')).toBe(CLOCK_MAX);
    expect(clockFontSize(335, '0:10')).toBe(CLOCK_MAX);
  });

  it('shrinks a time over a minute to fit a narrow screen, the same as a short one', () => {
    // 320 pt wide, 20 pt margins: the old fixed 132 pt clipped "1:10" to "1:…".
    const size = clockFontSize(280, '1:10');
    expect(size).toBeLessThan(CLOCK_MAX);
    expect(size * 0.6 * 4).toBeLessThanOrEqual(280);
    expect(clockFontSize(280, '0:10')).toBe(size);
  });

  it('fits a ten-minute interval', () => {
    const size = clockFontSize(280, '10:00');
    expect(size * 0.6 * 5).toBeLessThanOrEqual(280);
  });

  it('falls back to the full size before the width is known', () => {
    expect(clockFontSize(0, '1:10')).toBe(CLOCK_MAX);
  });

  it('gives a line height that holds the digits', () => {
    expect(clockLineHeight(CLOCK_MAX)).toBe(150);
    expect(clockLineHeight(100)).toBeGreaterThan(100);
  });
});
