import type { Tone } from './list';
import type { GlyphName } from './settings-icon';

/** What an objective records when completed, as chosen in Programs. */
export type RecordKind =
  'none' | 'workout' | 'circuit' | 'study' | 'weight' | 'money' | 'activity' | 'rules';

/** Each type's symbol and tile tone in the type list. */
export const OBJECTIVE_ICONS: Record<RecordKind, { icon: GlyphName; tone: Tone }> = {
  none: { icon: 'check', tone: 'slate' },
  workout: { icon: 'dumbbell', tone: 'rose' },
  circuit: { icon: 'timer', tone: 'rose' },
  study: { icon: 'book', tone: 'plum' },
  weight: { icon: 'scale', tone: 'sky' },
  money: { icon: 'dollar', tone: 'sun' },
  activity: { icon: 'run', tone: 'sky' },
  rules: { icon: 'rules', tone: 'plum' },
};

export const OBJECTIVE_TYPES: { id: RecordKind; title: string; hint: string }[] = [
  { id: 'none', title: 'Simple habit', hint: 'One Done or Skip, with optional instructions.' },
  {
    id: 'workout',
    title: 'Strength workout',
    hint: 'Log working sets. You add the exercises after saving.',
  },
  {
    id: 'circuit',
    title: 'Timed circuit',
    hint: 'The 14-minute interval timer. Name it and pick the days.',
  },
  {
    id: 'study',
    title: 'Study session',
    hint: 'One-tap Done with a study streak; an optional stage timer and links.',
  },
  {
    id: 'weight',
    title: 'Body-weight check-in',
    hint: 'One number. Optional and private; every day by default.',
  },
  { id: 'money', title: 'Money review', hint: 'Cash, savings and debt. Private by default.' },
  {
    id: 'activity',
    title: 'Cardio / activity session',
    hint: 'What you did and how many minutes.',
  },
  {
    id: 'rules',
    title: 'Rule-adherence review',
    hint: 'Yes, No or Not applicable. Private by default.',
  },
];
