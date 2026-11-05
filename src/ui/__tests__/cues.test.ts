import { describe, expect, it, jest } from '@jest/globals';
import { Cue } from '../../domain/intervals';

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(),
  setIsAudioActiveAsync: jest.fn(),
}));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
// eslint-disable-next-line import/first
import { cueAction, spokenText } from '../cues';

const cues: Cue[] = [
  { kind: 'start', label: 'Get ready', segment: 'prep', next: 'Crunches' },
  { kind: 'start', label: 'Jack Knives — Left', segment: 'work', next: 'Jack Knives — Right' },
  { kind: 'start', label: 'Rest', segment: 'rest', next: 'Toe Taps' },
  { kind: 'count', second: 3 },
  { kind: 'done' },
];

describe('timer cues', () => {
  it('mute never makes a sound', () => {
    for (const cue of cues) expect(cueAction('mute', cue)).toBeNull();
  });

  it('voice announces each interval and ticks the countdown', () => {
    expect(cues.map((cue) => cueAction('voice', cue))).toEqual([
      { speak: 'Get ready. First, Crunches.' },
      { speak: 'Jack Knives, Left.' },
      { speak: 'Rest. Next, Toe Taps.' },
      { tone: 'count' },
      { speak: 'Circuit complete.' },
    ]);
  });

  it('beeps use tones only: work, rest, countdown and the end sound different', () => {
    expect(cues.map((cue) => cueAction('beep', cue))).toEqual([
      { tone: 'rest' },
      { tone: 'start' },
      { tone: 'rest' },
      { tone: 'count' },
      { tone: 'done' },
    ]);
  });

  it('says what is first even with no next interval', () => {
    expect(spokenText({ kind: 'start', label: 'Rest', segment: 'rest', next: null })).toBe('Rest.');
  });
});
