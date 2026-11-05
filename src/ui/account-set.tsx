import { useState } from 'react';
import { Text, View } from 'react-native';
import { RuleBook, displayDate, accountSetPause, localDate, shiftDate } from '../domain/model';
import { accountSetPauseLine, loseAccountSet } from '../domain/trading';
import { stopForAccountSet } from '../domain/trading-live';
import { ACCOUNT_SET_PAUSE_DAYS, ACCOUNT_SET_RULE } from '../domain/trading-rules';
import { candleDate } from '../domain/market-clock';
import { putTradingSession, sessionUnreadable } from '../domain/trading-sessions';
import { useApp } from '../state/app-state';
import { Button, LinkButton, Sheet, styles } from './components';
import { palette, type } from './theme';

/**
 * The program-level rule under the trading objective in Programs: "If this account set is lost,
 * live trading is paused for 30 days." Account set lost pauses it from today, with the date it
 * resumes, and ends the current candle's running session as a hard stop; nothing in the app takes
 * that back early.
 */
export function AccountSetRule({ book }: { book: RuleBook }) {
  const { change } = useApp();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = localDate();
  const until = accountSetPause(book.trading, today);
  const resumes = shiftDate(today, ACCOUNT_SET_PAUSE_DAYS);
  const confirm = async () => {
    setError(null);
    const at = new Date().toISOString();
    try {
      // The pause already holds every live entry; ending the session says so on Trading too. Both
      // are saved together, or neither is.
      const saved = await change((s) => {
        const paused = loseAccountSet(s, book.routineId, at);
        const candle = candleDate(Date.parse(at));
        const session = s.tradingSessions[candle];
        if (!session || sessionUnreadable(s, candle)) return paused;
        const ended = stopForAccountSet(session, at);
        return ended === session ? paused : putTradingSession(paused, ended);
      });
      if (!saved) return;
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    // A line of its own under the trading row's links, which wrap side by side.
    <View testID="account-set-rule" style={{ width: '100%', gap: 2 }}>
      <Text style={{ ...type.caption, color: until ? palette.accent : palette.label2 }}>
        {until ? accountSetPauseLine(until) : ACCOUNT_SET_RULE}
      </Text>
      {!until && (
        <LinkButton
          title="Account set lost"
          label={`Account set lost: pause live trading for ${ACCOUNT_SET_PAUSE_DAYS} days`}
          tone="pill"
          onPress={() => setOpen(true)}
        />
      )}
      <Sheet title="Account set lost" visible={open} close={() => setOpen(false)}>
        <Text style={type.item}>{ACCOUNT_SET_RULE}</Text>
        <Text style={type.caption}>
          {`Live trading pauses from today until ${displayDate(resumes)}: a session running now ends as a hard stop, no session starts and the trading objective stays paused in Programs. It cannot be resumed earlier from the app. The cockpit stays open for study, and an entry already taken can still be logged.`}
        </Text>
        {error && (
          <Text accessibilityRole="alert" style={styles.alert}>
            {error}
          </Text>
        )}
        <Button
          title={`Pause until ${displayDate(resumes)}`}
          label={`Pause live trading until ${displayDate(resumes)}`}
          onPress={() => void confirm()}
        />
        <Button secondary title="Cancel" onPress={() => setOpen(false)} />
      </Sheet>
    </View>
  );
}
