import { useState } from 'react';
import { Text, View } from 'react-native';
import { exportFile } from '../data/export-file';
import {
  CATEGORIES,
  PRIVATE_AWARE,
  ExportCategory,
  ExportOptions,
  buildExport,
  encodeCsv,
  encodeJson,
  exportName,
} from '../domain/export';
import { localDate, shiftDate } from '../domain/model';
import { useApp } from '../state/app-state';
import { useAnnouncement } from '../ui/announce';
import { Button, Chip, Page, SectionLabel, styles } from '../ui/components';
import { Toggle } from '../ui/list';
import { Segmented } from '../ui/controls';
import { palette, type } from '../ui/theme';

const FORMATS = [
  ['csv', 'CSV'],
  ['json', 'JSON'],
] as const;

const RANGES: { key: string; label: string; days: number | null }[] = [
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: '365', label: '1 year', days: 365 },
  { key: 'all', label: 'All', days: null },
];

/**
 * Export chosen data for your own analysis, in a spreadsheet or another tool you choose. Life OS
 * sends nothing: the file goes only where you save or share it.
 */
export default function ExportScreen() {
  const { state } = useApp();
  const [categories, setCategories] = useState<ExportCategory[]>([]);
  const [range, setRange] = useState('90');
  const [format, setFormat] = useState<'json' | 'csv'>('csv');
  const [includePrivate, setIncludePrivate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  useAnnouncement(notice);
  useAnnouncement(error);
  const today = localDate();
  const days = RANGES.find((r) => r.key === range)!.days;
  const options: ExportOptions = {
    categories,
    from: days === null ? null : shiftDate(today, -(days - 1)),
    to: today,
    includePrivate,
  };
  const rows = buildExport(state, options);
  const counts = CATEGORIES.filter((c) => categories.includes(c.key)).map((c) => ({
    ...c,
    rows: rows.filter((r) => r.category === c.key).length,
  }));
  const sensitive = counts.filter((c) => c.sensitive);
  const toggle = (key: ExportCategory) =>
    setCategories((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
  const save = async () => {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const raw = format === 'json' ? encodeJson(state, options) : encodeCsv(state, options);
      setNotice(await exportFile(exportName(format, today), raw, format));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export. Nothing was changed.');
    } finally {
      setWorking(false);
    }
  };
  return (
    <Page title="Export" subtitle="For your own analysis" back>
      <Text style={styles.muted}>
        Choose what to include. Life OS uploads nothing and calls no AI: the file goes only where
        you save or share it. This is not a backup and cannot be restored.
      </Text>
      <SectionLabel title="Categories" />
      <View style={styles.row}>
        {CATEGORIES.map((c) => (
          <Chip
            key={c.key}
            role="checkbox"
            title={c.sensitive ? `${c.label} · sensitive` : c.label}
            on={categories.includes(c.key)}
            onPress={() => toggle(c.key)}
          />
        ))}
      </View>
      {categories.some((c) => PRIVATE_AWARE.includes(c)) && (
        <Toggle
          title="Include private routines"
          detail={
            includePrivate ? 'Private routines are in the file' : 'Private routines are left out'
          }
          value={includePrivate}
          onChange={setIncludePrivate}
        />
      )}
      <SectionLabel title="Dates" />
      <Segmented
        label="Dates"
        options={RANGES.map((r) => [r.key, r.label] as const)}
        value={range}
        onChange={setRange}
      />
      <SectionLabel title="Format" />
      <Segmented label="Format" options={FORMATS} value={format} onChange={setFormat} />
      <View style={[styles.card, { gap: 6 }]}>
        <SectionLabel title="Preview" count={`${rows.length} row${rows.length === 1 ? '' : 's'}`} />
        {counts.map((c) => (
          <Text key={c.key} style={{ ...type.meta, color: palette.label2 }}>
            {c.label}: {c.rows} row{c.rows === 1 ? '' : 's'} · {c.description}
          </Text>
        ))}
        <Text style={styles.muted}>
          {options.from
            ? `From ${options.from} to ${options.to}.`
            : `All history to ${options.to}.`}{' '}
          Blank values mean not reported; days without a record are absent, not zero.
        </Text>
      </View>
      {(sensitive.length > 0 ||
        (includePrivate && categories.some((c) => PRIVATE_AWARE.includes(c)))) && (
        <View accessibilityRole="alert" style={[styles.card, { borderColor: palette.accentEdge }]}>
          <Text style={{ ...type.callout, color: palette.accent }}>Sensitive data included</Text>
          <Text style={styles.body}>
            {[
              ...sensitive.map((c) => c.label),
              ...(includePrivate ? ['private routines'] : []),
            ].join(', ')}{' '}
            will be in the file. Anyone or any service you give it to can read it.
          </Text>
        </View>
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.alert}>
          {error}
        </Text>
      )}
      {notice && <Text style={styles.muted}>{notice}</Text>}
      <Button
        title={`Export ${format.toUpperCase()}`}
        disabled={!categories.length || working}
        needs={categories.length ? '' : 'Choose at least one category to export.'}
        onPress={() => void save()}
      />
    </Page>
  );
}
