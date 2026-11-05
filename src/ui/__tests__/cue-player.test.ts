import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Cue } from '../../domain/intervals';

// The native modules are replaced by recorders: these tests check which audio calls the timer
// makes, not how iOS responds to them (that needs the iPhone).
const mockCalls: string[] = [];
const mockPlayers: { released: boolean }[] = [];
let mockFail = false;
jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(async (mode: unknown) => {
    mockCalls.push(`mode:${JSON.stringify(mode)}`);
    if (mockFail) throw new Error('session failed');
  }),
  setIsAudioActiveAsync: jest.fn(async (active: boolean) => {
    mockCalls.push(`active:${active}`);
  }),
  createAudioPlayer: jest.fn(() => {
    const player = {
      released: false,
      seekTo: async () => {},
      play: () => mockCalls.push('tone'),
      release: () => {
        player.released = true;
      },
    };
    mockPlayers.push(player);
    return player;
  }),
}));
jest.mock('expo-speech', () => ({
  speak: jest.fn((text: string, options: unknown) =>
    mockCalls.push(`speak:${text}:${JSON.stringify(options)}`),
  ),
  stop: jest.fn(async () => {
    mockCalls.push('stop');
  }),
}));
// eslint-disable-next-line import/first
import { CUE_AUDIO_MODE, CuePlayer } from '../cues';

const work: Cue = { kind: 'start', label: 'Plank', segment: 'work', next: null };
const count: Cue = { kind: 'count', second: 3 };

beforeEach(() => {
  mockCalls.length = 0;
  mockPlayers.length = 0;
  mockFail = false;
});

describe('timer audio calls', () => {
  it('Mute makes no audio call at all: no session, no player, no speech', async () => {
    const cues = new CuePlayer('mute');
    await cues.play(work);
    await cues.play(count);
    cues.dispose();
    expect(mockCalls.filter((c) => c !== 'stop')).toEqual([]);
    expect(mockPlayers).toHaveLength(0);
  });

  it('the session mixes with other apps (never pauses or ducks them) and is set once', async () => {
    expect(CUE_AUDIO_MODE.interruptionMode).toBe('mixWithOthers');
    const cues = new CuePlayer('beep');
    await cues.play(work);
    await cues.play(count);
    const modes = mockCalls.filter((c) => c.startsWith('mode:'));
    expect(modes).toEqual([`mode:${JSON.stringify(CUE_AUDIO_MODE)}`]);
    expect(modes[0]).not.toMatch(
      /duckOthers|doNotMix|"shouldPlayInBackground":true|"allowsRecording":true/,
    );
    expect(mockCalls).toContain('active:true');
    expect(mockCalls.filter((c) => c === 'tone')).toHaveLength(2);
  });

  it('voice speaks on the application session; switching modes never reconfigures the session', async () => {
    const cues = new CuePlayer('voice');
    await cues.play(work);
    expect(mockCalls.find((c) => c.startsWith('speak:'))).toBe(
      'speak:Plank.:{"useApplicationAudioSession":true,"rate":1,"language":"en-US"}',
    );
    cues.setMode('beep');
    await cues.play(count);
    cues.setMode('mute');
    await cues.play(work);
    cues.setMode('voice');
    await cues.play(work);
    expect(mockCalls.filter((c) => c.startsWith('mode:'))).toHaveLength(1);
    expect(mockCalls.filter((c) => c === 'active:false')).toHaveLength(0);
  });

  it('a failed session setup skips cues instead of playing on a default session', async () => {
    mockFail = true;
    const cues = new CuePlayer('beep');
    await cues.play(work);
    expect(mockPlayers).toHaveLength(0);
    expect(mockCalls.filter((c) => c === 'tone' || c.startsWith('speak'))).toEqual([]);
  });

  it('closing the timer releases every player, stops speech and ends the session', async () => {
    const cues = new CuePlayer('beep');
    await cues.play(work);
    await cues.play(count);
    cues.dispose();
    expect(mockPlayers.length).toBeGreaterThan(0);
    expect(mockPlayers.every((p) => p.released)).toBe(true);
    expect(mockCalls).toContain('stop');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockCalls.at(-1)).toBe('active:false');
    // Nothing plays after closing.
    mockCalls.length = 0;
    await cues.play(work);
    expect(mockCalls).toEqual([]);
  });

  it('closing while the session is still being set up deactivates after the setup, not before', async () => {
    const cues = new CuePlayer('beep');
    const playing = cues.play(work);
    cues.dispose();
    await playing;
    await new Promise((r) => setTimeout(r, 0));
    const active = mockCalls.filter((c) => c.startsWith('active:'));
    expect(active).toEqual(['active:true', 'active:false']);
    // And nothing was played once closed.
    expect(mockCalls).not.toContain('tone');
  });
});
