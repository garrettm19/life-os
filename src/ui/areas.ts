import type { Program } from '../domain/model';
import type { Tone } from './list';
import type { GlyphName } from './settings-icon';

/**
 * A program's area on Programs: a symbol and a tone for the tile beside its name, read from the
 * words of its title and group. Presentation only: it changes nothing about the program and stands
 * for no state, so an area the words do not name gets the neutral stack.
 */
export type Area = { symbol: GlyphName; tone: Tone };

const AREAS: [RegExp, Area][] = [
  [/trad|market|futures|invest/, { symbol: 'chart', tone: 'sky' }],
  [/money|financ|debt|budget|saving|spend/, { symbol: 'dollar', tone: 'sun' }],
  [/morning|sleep|foundation|wake|evening|night|wind.?down/, { symbol: 'sunrise', tone: 'sun' }],
  [/cardio|\brun|sport|walk|swim|bike|cycl|hike|activity/, { symbol: 'run', tone: 'sky' }],
  [
    /strength|train|workout|gym|lift|extras|mobility|physique|\bbody|fitness/,
    { symbol: 'dumbbell', tone: 'rose' },
  ],
  [/study|learn|course|\bread(ing)?\b|book|class|\bexams?\b/, { symbol: 'book', tone: 'plum' }],
  [
    /career|engineer|\bjob|work|skill|\bcod(e|ing)\b|portfolio|interview/,
    { symbol: 'briefcase', tone: 'plum' },
  ],
  [
    /friend|social|relationship|family|partner|\bdat(e|ing)\b|people|connect/,
    { symbol: 'people', tone: 'rose' },
  ],
  [/home|house|chore|clean|errand/, { symbol: 'house', tone: 'slate' }],
  [/health|mind|mood|medit|journal|calm|wellbeing|wellness/, { symbol: 'heart', tone: 'plum' }],
];

const OTHER: Area = { symbol: 'stack', tone: 'slate' };

export function programArea(program: Pick<Program, 'title' | 'group'>): Area {
  // The title says most about a program; the group decides when the title names no area.
  for (const words of [program.title, program.group]) {
    const text = words.toLowerCase();
    const found = AREAS.find(([pattern]) => pattern.test(text));
    if (found) return found[1];
  }
  return OTHER;
}
