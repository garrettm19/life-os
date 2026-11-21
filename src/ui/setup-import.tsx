import { ReactNode, useState } from 'react';
import { Text, View } from 'react-native';
import { pickSetup } from '../data/pick-setup';
import { MAX_VIOLATIONS } from '../domain/records';
import {
  SetupPreview,
  TradingUpdate,
  importSetup,
  keptRecordsText,
  previewSetup,
} from '../domain/setup';
import { useApp } from '../state/app-state';
import { Button, Sheet, styles } from './components';

export type SetupImported = { programs: number; routines: number; first: boolean };

/**
 * Importing a setup file, shared by Settings and Today's Load my setup: choose a file (or paste
 * one in Settings), see what it would change in a sheet, and only then import. Closing the sheet
 * imports nothing.
 */
export function useSetupImport({
  onError,
  onImported,
}: {
  onError: (message: string | null) => void;
  onImported: (result: SetupImported) => void;
}): { choose: () => Promise<void>; importText: (text: string) => Promise<void>; sheet: ReactNode } {
  const { state, change } = useApp();
  const [preview, setPreview] = useState<{ text: string; summary: SetupPreview } | null>(null);
  const importText = async (text: string) => {
    try {
      setPreview({ text, summary: previewSetup(text, state, new Date().toISOString()) });
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not read that setup.');
    }
  };
  const confirmImport = async (pauseSameNamed: boolean) => {
    if (!preview) return;
    const text = preview.text;
    // Counted from the imported state itself, inside the save.
    const result = { programs: 0, routines: 0, first: !state.programs.length };
    const okay = await change((s) => {
      const next = importSetup(text, s, new Date().toISOString(), { pauseSameNamed });
      result.programs = next.programs.length;
      result.routines = next.programs.reduce((sum, p) => sum + p.routines.length, 0);
      return next;
    });
    if (okay) {
      setPreview(null);
      onImported(result);
    }
  };
  const choose = async () => {
    // A new choice starts clean: the last file's error goes.
    onError(null);
    try {
      const text = await pickSetup();
      if (text !== null) await importText(text);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };
  const sheet = (
    <Sheet title="Import this setup?" visible={preview !== null} close={() => setPreview(null)}>
      {preview && <SetupSummary summary={preview.summary} />}
      {preview?.summary.conflicts.length ? (
        <>
          <Button
            title={`Import and pause ${new Set(preview.summary.conflicts.map((c) => c.existing.id)).size} same-named`}
            label="Import and pause the existing routines with the same names"
            onPress={() => void confirmImport(true)}
          />
          <Button
            secondary
            title="Import and keep both"
            label="Import and keep the existing same-named routines active too"
            onPress={() => void confirmImport(false)}
          />
        </>
      ) : (
        <Button
          title="Import"
          label="Import this setup"
          onPress={() => void confirmImport(false)}
        />
      )}
      <Text style={styles.muted}>
        Closing imports nothing. Importing never changes recorded history, and pausing a routine
        keeps its history.
      </Text>
    </Sheet>
  );
  return { choose, importText, sheet };
}

const RISK_NAMES: Record<TradingUpdate['risk'][number], string> = {
  maxContracts: 'contract',
  thesisRisk: 'thesis-risk',
  dailyLoss: 'daily loss',
};

/** "Updates Trading discipline: 2 items reworded and 6 hard violations added. …" */
function tradingUpdateText(update: TradingUpdate): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [
    update.reworded > 0 && `${plural(update.reworded, 'item')} reworded`,
    update.violationsAdded > 0 && `${plural(update.violationsAdded, 'hard violation')} added`,
    update.maxEntries !== null && `the entry limit set to ${update.maxEntries}`,
    update.instrument !== null && `the instrument set to ${update.instrument}`,
    update.risk.length > 0 &&
      `the ${update.risk.map((k) => RISK_NAMES[k]).join(', ')} limit${update.risk.length === 1 ? '' : 's'} set`,
  ].filter((p): p is string => !!p);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `Updates Trading discipline${list ? `: ${list}` : ''}. Earlier reviews keep their answers and stay scored as they were.`;
}

/** What a setup import would change, in plain lists. */
function SetupSummary({ summary }: { summary: SetupPreview }) {
  const line = (label: string, items: string[]) =>
    items.length ? (
      <Text style={styles.body}>
        {label} ({items.length}): {items.join(', ')}
      </Text>
    ) : null;
  return (
    <View style={{ gap: 8 }}>
      {line('New programs', summary.programsAdded)}
      {line('Programs replaced by the file', summary.programsReplaced)}
      {line('Already the same', summary.programsUnchanged)}
      {line('New routines', summary.routinesAdded)}
      {line('Routines replaced by the file', summary.routinesReplaced)}
      {line('Optional (never block Day Cleared)', summary.optionalRoutines)}
      {line('Placed in the order of the day', summary.orderSet)}
      {summary.plansAdded + summary.circuitsAdded + summary.rulebooksAdded > 0 && (
        <Text style={styles.body}>
          Adds {summary.plansAdded} workout plan{summary.plansAdded === 1 ? '' : 's'},{' '}
          {summary.circuitsAdded} timed circuit{summary.circuitsAdded === 1 ? '' : 's'} and{' '}
          {summary.rulebooksAdded} rulebook{summary.rulebooksAdded === 1 ? '' : 's'}
          {summary.rulebooksWithTrading > 0 &&
            (summary.rulebooksAdded === 1
              ? ' with Trading discipline, starting today'
              : `, ${summary.rulebooksWithTrading} with Trading discipline, starting today`)}
          .
        </Text>
      )}
      {summary.tradingAdded > 0 && (
        <Text style={styles.body}>
          Adds Trading discipline to your trading rulebook, starting today. Its rules and earlier
          reviews stay exactly as they are.
        </Text>
      )}
      {summary.tradingUpdated && (
        <Text testID="trading-updated" style={styles.body}>
          {tradingUpdateText(summary.tradingUpdated)}
        </Text>
      )}
      {line(
        `Hard violations left out: Trading discipline holds at most ${MAX_VIOLATIONS}`,
        summary.violationsLeftOut,
      )}
      {keptRecordsText(summary.recordsKept) && (
        <Text style={styles.muted}>
          {keptRecordsText(summary.recordsKept)} in the file left alone: those routines already have
          one.
        </Text>
      )}
      {line('Kept as set on this device', summary.keptOnDevice)}
      <Text style={styles.body}>
        {summary.historyKept.days + summary.historyKept.records > 0
          ? `Keeps your history: ${summary.historyKept.days} recorded day${summary.historyKept.days === 1 ? '' : 's'} and ${summary.historyKept.records} record${summary.historyKept.records === 1 ? '' : 's'}, unchanged. `
          : ''}
        Nothing new starts before today.
      </Text>
      <Text style={styles.muted}>
        {summary.settingsReplaced ? 'Replaces your schedule settings. ' : 'Keeps your settings. '}
        {summary.notesReplaced ? 'Replaces your notes.' : 'Keeps your notes.'}
      </Text>
      {summary.gaps.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={styles.heading}>Still to set up after importing</Text>
          {summary.gaps.map((gap) => (
            <Text key={gap} style={styles.muted}>
              • {gap}
            </Text>
          ))}
        </View>
      )}
      {summary.conflicts.length > 0 && (
        <View accessibilityRole="alert" style={[styles.notice, { gap: 6 }]}>
          <Text style={styles.heading}>Same names as your routines</Text>
          {summary.conflicts.map((c) => (
            <Text key={`${c.existing.id}-${c.incoming.id}`} style={styles.muted}>
              {c.title}: yours in {c.existing.program}, the file&apos;s in {c.incoming.program}
            </Text>
          ))}
          <Text style={styles.muted}>
            Pause yours to avoid doing the same thing twice, or keep both.
          </Text>
        </View>
      )}
    </View>
  );
}
