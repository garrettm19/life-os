import { useCallback, useEffect, useRef } from 'react';
import {
  AudioPlayer,
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
} from 'expo-audio';
import * as Speech from 'expo-speech';
import { Cue } from '../domain/intervals';
import { CueMode } from '../domain/model';

// Timer cues layered over whatever the user is already playing (for example Spotify).
//
// The audio session is set to play alongside other apps (`mixWithOthers`): never `doNotMix`, which
// pauses other audio, and never `duckOthers`, which lowers it. Speech uses this same application
// session (`useApplicationAudioSession: true`), so it mixes the same way instead of letting the
// system manage, and possibly duck, a separate speech session. Whether this keeps Spotify playing
// at full volume on an actual iPhone (speaker and Bluetooth) is UNVERIFIED until tested on the
// device. Nothing here records, streams or uses the network; the tones are bundled files.

const SOUNDS = {
  count: require('../../assets/sounds/count.wav'),
  start: require('../../assets/sounds/start.wav'),
  rest: require('../../assets/sounds/rest.wav'),
  done: require('../../assets/sounds/done.wav'),
} as const;
export type Sound = keyof typeof SOUNDS;

/** What is spoken for a cue in voice mode; null for cues that are tones only. */
export function spokenText(cue: Cue): string | null {
  const say = (label: string) => label.replace(' — ', ', ');
  if (cue.kind === 'done') return 'Circuit complete.';
  if (cue.kind === 'count') return null;
  if (cue.segment === 'prep')
    return cue.next ? `Get ready. First, ${say(cue.next)}.` : 'Get ready.';
  if (cue.segment === 'rest') return cue.next ? `Rest. Next, ${say(cue.next)}.` : 'Rest.';
  return `${say(cue.label)}.`;
}

/** The tone for a cue in beep mode (and the count ticks in voice mode). */
function toneFor(cue: Cue): Sound {
  if (cue.kind === 'count') return 'count';
  if (cue.kind === 'done') return 'done';
  return cue.segment === 'work' ? 'start' : 'rest';
}

/**
 * What a cue does in a mode: speak, play a tone, or nothing. Mute is always nothing. Voice speaks
 * announcements and ticks the countdown; Beeps uses tones only.
 */
export function cueAction(mode: CueMode, cue: Cue): { speak: string } | { tone: Sound } | null {
  if (mode === 'mute') return null;
  const text = mode === 'voice' ? spokenText(cue) : null;
  return text === null ? { tone: toneFor(cue) } : { speak: text };
}

/**
 * The audio session options for timer cues: play alongside other apps, never pause or duck them.
 */
export const CUE_AUDIO_MODE = {
  interruptionMode: 'mixWithOthers',
  playsInSilentMode: true,
  shouldPlayInBackground: false,
  allowsRecording: false,
} as const;

/** Speech on the application session, so it mixes the same way as the tones. */
const SPEECH_OPTIONS = { useApplicationAudioSession: true, rate: 1, language: 'en-US' };

/**
 * Plays timer cues in a mode. Mute plays nothing and touches no audio API. The shared session is
 * configured (mix with others) and activated once, before the first sound; if that fails, cues
 * are skipped rather than played on a default session that could interrupt other audio. Tone
 * players are made on first use. `dispose` releases them and deactivates the session.
 */
export class CuePlayer {
  private mode: CueMode;
  private players: Partial<Record<Sound, AudioPlayer>> = {};
  private ready: Promise<boolean> | null = null;
  private disposed = false;

  constructor(mode: CueMode) {
    this.mode = mode;
  }

  setMode(mode: CueMode) {
    this.mode = mode;
    if (mode !== 'voice') void Speech.stop().catch(() => {});
  }

  private prepare(): Promise<boolean> {
    this.ready ??= setAudioModeAsync(CUE_AUDIO_MODE)
      .then(() => setIsAudioActiveAsync(true))
      .then(() => true)
      .catch(() => {
        this.ready = null;
        return false;
      });
    return this.ready;
  }

  private tone(sound: Sound) {
    try {
      let player = this.players[sound];
      if (!player) {
        // Keeping the session active between tones avoids reactivating it for every beep.
        player = createAudioPlayer(SOUNDS[sound], { keepAudioSessionActive: true });
        this.players[sound] = player;
      }
      void player.seekTo(0).catch(() => {});
      player.play();
    } catch {}
  }

  play(cue: Cue): Promise<void> {
    const mode = this.mode;
    if (mode === 'mute' || this.disposed) return Promise.resolve();
    return this.prepare().then((ready) => {
      if (!ready || this.disposed || this.mode !== mode) return;
      const action = cueAction(mode, cue);
      if (!action) return;
      if ('tone' in action) {
        this.tone(action.tone);
        return;
      }
      // A new announcement replaces one still being spoken, so speech never lags the timer.
      return Speech.stop()
        .catch(() => {})
        .then(() => Speech.speak(action.speak, SPEECH_OPTIONS))
        .catch(() => {});
    });
  }

  dispose() {
    this.disposed = true;
    void Speech.stop().catch(() => {});
    for (const player of Object.values(this.players)) {
      try {
        // `release` frees the native player; the docs require it for createAudioPlayer.
        player?.release();
      } catch {}
    }
    this.players = {};
    // Deactivating a mixable session never interrupts other apps; it only ends ours. A setup
    // still in flight is awaited first, so its activation cannot land after the deactivation.
    const pending = this.ready;
    this.ready = null;
    if (pending)
      void pending.then((ok) => (ok ? setIsAudioActiveAsync(false) : undefined)).catch(() => {});
  }
}

/**
 * Plays cues in the chosen mode for as long as the timer is open, and cleans up when it closes.
 */
export function useCues(mode: CueMode): (cue: Cue) => void {
  const player = useRef<CuePlayer | null>(null);
  useEffect(() => {
    const cues = new CuePlayer(mode);
    player.current = cues;
    return () => {
      cues.dispose();
      player.current = null;
    };
    // One player per open timer; mode changes are applied below without recreating it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    player.current?.setMode(mode);
  }, [mode]);
  return useCallback((cue: Cue) => void player.current?.play(cue), []);
}
