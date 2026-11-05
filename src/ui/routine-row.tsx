import { Children, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Routine } from '../domain/model';
import { routineSummary } from '../domain/routines';
import { PressableScale } from './motion';
import { Glyph } from './settings-icon';
import { palette, type } from './theme';

/** What a routine records, in a word or two, or null for a plain habit or timed block. */
export function routineKind(r: Routine, workout: boolean, circuit: boolean): string | null {
  if (r.study) return 'Study';
  if (workout) return 'Workout';
  if (circuit) return 'Timed circuit';
  if (r.capture === 'weight') return 'Weigh-in';
  if (r.capture === 'money') return 'Money review';
  if (r.capture === 'activity') return 'Cardio';
  if (r.capture === 'rules') return 'Rule review';
  return null;
}

/**
 * One routine in Programs: its title in full, one line saying what it is and when, and the whole
 * row opens its settings. Specialized editors (plan, circuit, rules) sit under it as quiet links.
 */
export function RoutineRow({
  routine,
  kind,
  parent,
  inRotation = false,
  onConfigure,
  children,
}: {
  routine: Routine;
  kind: string | null;
  /** The program a bundled routine shares its time with. */
  parent: string | null;
  /** Its program's rotation schedules it, so it has no weekdays of its own. */
  inRotation?: boolean;
  onConfigure: () => void;
  children?: ReactNode;
}) {
  const flags = [
    parent ? `inside ${parent}` : routine.enabled ? null : 'paused',
    routine.private ? 'private' : null,
    routine.optional ? 'optional' : null,
  ].filter(Boolean);
  const active = routine.enabled || !!parent;
  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator }}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Configure ${routine.title}`}
        onPress={onConfigure}
        style={{
          minHeight: 52,
          paddingVertical: 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.item, color: active ? palette.label : palette.label2 }}>
            {routine.title}
          </Text>
          <Text style={type.caption}>
            {kind ? `${kind} · ` : ''}
            <Text>{routineSummary(routine, inRotation, !!kind)}</Text>
            {flags.length ? ` · ${flags.join(' · ')}` : ''}
          </Text>
        </View>
        <Glyph name="chevron" color={palette.label3} size={15} />
      </PressableScale>
      {Children.toArray(children).length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            columnGap: 8,
            marginTop: -8,
            marginBottom: 4,
          }}>
          {children}
        </View>
      )}
    </View>
  );
}
