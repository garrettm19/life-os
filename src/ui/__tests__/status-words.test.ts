import { describe, expect, it } from '@jest/globals';
import { STATUS_TABLE } from '../../domain/trading-status';
import { statusWords } from '../status-words';

describe("the status on Today's trading row", () => {
  it('reads the cockpit title in sentence case, keeping abbreviations, places and times', () => {
    expect(statusWords('NO TRADE — PREPARATION INCOMPLETE')).toBe(
      'No trade — preparation incomplete',
    );
    expect(statusWords('NO TRADE — HTF UNCLEAR')).toBe('No trade — HTF unclear');
    expect(statusWords('NO ENTRY — CONFIRM YOUR PLAN FOR THIS GEX')).toBe(
      'No entry — confirm your plan for this GEX',
    );
    expect(statusWords("NOT STARTED — TAP I'M READY")).toBe("Not started — tap I'm ready");
    expect(statusWords('IN POSITION — FLAT BY 4:45 PM NEW YORK')).toBe(
      'In position — flat by 4:45 PM New York',
    );
    expect(statusWords('SETUP CHECKS COMPLETE — SELF-REPORTED')).toBe(
      'Setup checks complete — self-reported',
    );
  });

  it('never shouts: no status title keeps a run of capitals beyond HTF and GEX', () => {
    for (const { title } of STATUS_TABLE) {
      const words = statusWords(title);
      expect(words.toLowerCase()).toBe(title.toLowerCase());
      expect(words.replace(/\b(HTF|GEX)\b/g, '')).not.toMatch(/[A-Z]{2,}/);
    }
  });
});
