import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import { displayDate, localDate } from '../domain/model';
import { PreviewItem, tomorrowPreview } from '../domain/preview';
import { useApp } from '../state/app-state';
import { styles } from './components';
import { PressableScale } from './motion';
import { fonts, palette, radius, type } from './theme';

function tag(item: PreviewItem): string | null {
  if (item.time) return item.time;
  if (item.projected) return 'projected';
  if (item.kind === 'optional') return 'optional';
  return null;
}

/**
 * A folded, read-only look at tomorrow at the bottom of Today. Nothing here is saved: opening it
 * never creates or completes anything. Rotation workouts are labeled as a projection.
 */
export function TomorrowPreview({ now }: { now: Date }) {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const day = localDate(now);
  // Recomputed only when the saved state or the day changes, not on every clock tick.
  const preview = useMemo(() => tomorrowPreview(state, new Date(`${day}T12:00:00`)), [state, day]);
  const due = preview.items.filter((i) => i.kind !== 'rest' && i.kind !== 'optional').length;
  const summary = preview.protected
    ? 'protected'
    : `${due} due${preview.items.some((i) => i.kind === 'optional') ? ' · optional too' : ''}`;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: palette.separator,
        borderRadius: radius.card,
        backgroundColor: palette.surface,
      }}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Tomorrow, ${displayDate(preview.date)}: ${summary}. ${open ? 'Hide' : 'Show'} preview`}
        aria-expanded={open}
        onPress={() => setOpen(!open)}
        style={[styles.spread, { minHeight: 48, paddingHorizontal: 14 }]}>
        <Text style={{ ...type.meta, color: palette.label2, flexShrink: 1 }}>
          {open ? '▾' : '▸'} Tomorrow · {displayDate(preview.date)}
        </Text>
        <Text style={{ ...type.meta, color: palette.label3 }}>{summary}</Text>
      </PressableScale>
      {open && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 6 }}>
          {preview.protected && (
            <Text style={styles.muted}>Tomorrow is protected; the streak is held.</Text>
          )}
          {!preview.items.length && <Text style={styles.muted}>Nothing is due tomorrow yet.</Text>}
          {preview.items.map((item) => (
            <View
              key={item.id}
              accessible
              accessibilityLabel={`${item.title}${tag(item) ? `, ${tag(item)}` : ''}`}
              style={[styles.spread, { minHeight: 30, flexWrap: 'nowrap' }]}>
              <Text
                style={{
                  ...type.item,
                  fontSize: 14,
                  flex: 1,
                  color:
                    item.kind === 'rest' || item.kind === 'optional'
                      ? palette.label2
                      : palette.label,
                }}>
                {item.title}
              </Text>
              {tag(item) && (
                <Text
                  style={{
                    ...fonts.semibold,
                    fontSize: 11,
                    color: item.projected ? palette.accent : palette.label3,
                  }}>
                  {tag(item)}
                </Text>
              )}
            </View>
          ))}
          {preview.items.some((i) => i.projected) && (
            <Text style={styles.muted}>
              Projected: the rotation continues as if today&apos;s workout is done; it is set when
              tomorrow opens.
            </Text>
          )}
          <Text style={styles.muted}>
            {preview.items.some((i) => i.kind === 'timed')
              ? ''
              : 'Timed sessions appear once tomorrow is planned. '}
            <Link href="/week" dismissTo style={{ color: palette.label, ...fonts.semibold }}>
              Open the week
            </Link>
          </Text>
        </View>
      )}
    </View>
  );
}
