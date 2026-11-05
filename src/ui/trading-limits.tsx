import { ReactNode, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { candleDate } from '../domain/market-clock';
import { RuleBook, TradingProfile, clock, displayDate } from '../domain/model';
import { parseWhole } from '../domain/numbers';
import {
  INSTRUMENT_NAME,
  MAX_ACCOUNTS,
  MAX_CONTRACTS,
  MAX_ENTRIES,
  MAX_LOSS_RUN,
  validFlatBy,
} from '../domain/records';
import { gateSessions } from '../domain/trading';
import {
  APP_LEVEL_LINE,
  BEFORE_LIVE_LINE,
  COOLDOWN_MINUTES,
  EXISTING_ACCOUNTS_LINE,
  EXISTING_ACCOUNT_LINE,
  LIVE_OFF_LINE,
  cooldownMinutesOf,
  liveByExistingAccount,
  liveSwitchProblem,
  liveTradingOn,
  saveLimits,
  setLiveTrading,
} from '../domain/trading-live';
import { parseContracts, parsePrice, priceText } from '../domain/trading-prices';
import {
  MONEY_INFO_LINE,
  MONEY_NO_LINE,
  MONEY_QUESTION,
  gateLines,
  maxEntriesOf,
  maxLossRunOf,
  waitingRaiseLine,
} from '../domain/trading-safeguards';
import { useApp } from '../state/app-state';
import { Button, Field, Sheet, styles } from './components';
import { Toggle } from './list';
import { palette, type } from './theme';
import { useLiveClock } from './use-live';

/** "Label: value" per line, units kept as written. Existing IDs stay by position. */
function parseLimits(text: string, previous: TradingProfile['limits']): TradingProfile['limits'] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const at = line.indexOf(':');
      const label = at > 0 ? line.slice(0, at).trim() : line;
      const value = at > 0 ? line.slice(at + 1).trim() : '';
      if (!value) throw new Error(`Write line ${i + 1} as "Label: value".`);
      return { id: previous[i]?.id ?? `limit-${i + 1}`, label, value };
    });
}

/** A typed amount or price above zero, null when blank; anything else is refused with `what`. */
function amount(text: string, what: string): number | null {
  if (!text.trim()) return null;
  const n = parsePrice(text);
  if (n === null || n <= 0)
    throw new Error(`Enter ${what} as a number above zero, or leave it blank.`);
  return n;
}

/**
 * A dollar amount to the cent, null when blank: risk is counted to the cent, so a plan shown as
 * $150 is never above a limit shown as $150. With `zero`, $0 is allowed (a commission).
 */
function dollars(text: string, what: string, zero = false): number | null {
  if (zero && text.trim() && parsePrice(text) === 0) return 0;
  const n = amount(text, what);
  if (n !== null && Math.abs(n * 100 - Math.round(n * 100)) > 1e-6)
    throw new Error(`Enter ${what} in dollars to the cent, or leave it blank.`);
  return n;
}

/** A whole number from `min` to `max`, null when blank. */
function count(text: string, min: number, max: number, what: string): number | null {
  const n = parseWhole(text);
  if (n === null) return null;
  if (!(n >= min && n <= max))
    throw new Error(`Enter ${what} as a whole number from ${min} to ${max}, or leave it blank.`);
  return n;
}

const shown = (n: number | null | undefined) => (n == null ? '' : priceText(n));

/** A flat-by time typed as New York 24-hour time ("9:05" or "09:05"), "HH:MM"; blank is none. */
function flatByTime(text: string): string | undefined {
  if (!text.trim()) return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  const time = match && clock(Number(match[1]) * 60 + Number(match[2]));
  if (!match || Number(match[2]) > 59 || !validFlatBy(time))
    throw new Error(
      'Enter the flat-by time as 24-hour New York time before 18:00, or leave it blank.',
    );
  return time;
}

/** A section of the form: a heading over a hairline, so the long sheet reads in parts. */
function Section({ title }: { title: string }) {
  return (
    <Text
      accessibilityRole="header"
      style={{
        ...type.heading,
        paddingTop: 14,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.separator,
      }}>
      {title}
    </Text>
  );
}

/** Two fields side by side. */
function Pair({ children }: { children: [ReactNode, ReactNode] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ flex: 1 }}>{children[0]}</View>
      <View style={{ flex: 1 }}>{children[1]}</View>
    </View>
  );
}

/**
 * Your limits, set outside the session: the fixed dollars risked per trade (the stop sets the
 * size), the thesis budget, the session's maximum loss (per account, and optionally in total
 * across accounts), the contract limit, the accounts each execution is copied to, the session's
 * entry cap and losses in a row, the cooldown, the estimated costs and the instrument. No risk
 * limit has a default: one left blank holds every entry until it is set. A raise waits for the next
 * candle's session; more accounts and live trading wait for their clean sessions, shown here as
 * plain counts, or live trading is turned on for one live account already traded, confirmed
 * plainly. Live trading is off until turned on here, after the money question, and never during a
 * session, a cooldown, a stop or a pause. The optional flat-by time is a New York time. Nothing
 * here is checked at a broker.
 */
export function TradingLimitsSheet({
  book,
  visible,
  close,
}: {
  book: RuleBook;
  visible: boolean;
  close: () => void;
}) {
  return visible ? <LimitsForm book={book} close={close} /> : null;
}

function LimitsForm({ book, close }: { book: RuleBook; close: () => void }) {
  const { change, state } = useApp();
  const profile = book.trading!;
  const risk = profile.risk;
  const [text, setText] = useState(profile.limits.map((l) => `${l.label}: ${l.value}`).join('\n'));
  const [name, setName] = useState(profile.instrument?.name ?? '');
  const [pointValue, setPointValue] = useState(shown(profile.instrument?.pointValue));
  const [tick, setTick] = useState(shown(profile.instrument?.tick));
  const [tradeRisk, setTradeRisk] = useState(shown(risk?.tradeRisk));
  const [thesisRisk, setThesisRisk] = useState(shown(risk?.thesisRisk));
  const [dailyLoss, setDailyLoss] = useState(shown(risk?.dailyLoss));
  const [contracts, setContracts] = useState(
    risk?.maxContracts == null ? '' : String(risk.maxContracts),
  );
  const [accounts, setAccounts] = useState(String(profile.accounts ?? 1));
  const [cooldown, setCooldown] = useState(String(cooldownMinutesOf(profile)));
  const [entries, setEntries] = useState(String(maxEntriesOf(profile)));
  const [lossRun, setLossRun] = useState(String(maxLossRunOf(profile)));
  const [total, setTotal] = useState(shown(profile.dailyLossTotal));
  const [flatBy, setFlatBy] = useState(profile.flatBy ?? '');
  /**
   * Turning live on: the practice gate with the offer for one live account already traded, its
   * confirmation, the money question while it is asked, then the kind line after a No.
   */
  const [money, setMoney] = useState<
    { step: 'gated'; why: string } | { step: 'existing' | 'asked' | 'no' } | null
  >(null);
  /** Live trading is being turned on for one live account already traded. */
  const [existing, setExisting] = useState(false);
  const [commission, setCommission] = useState(shown(profile.costs?.commission));
  const [slippage, setSlippage] = useState(
    profile.costs?.slippageTicks == null ? '' : String(profile.costs.slippageTicks),
  );
  const [error, setError] = useState<string | null>(null);
  const live = liveTradingOn(profile);
  const candle = candleDate(useLiveClock());
  const raise = waitingRaiseLine(profile, candle);
  const gates = gateLines(gateSessions(state, book.routineId), profile.accounts ?? 1);
  const switchLive = async () => {
    setError(null);
    const at = new Date().toISOString();
    if (live) {
      setMoney(null);
      await change((s) => setLiveTrading(s, book.routineId, false, at));
      return;
    }
    setExisting(false);
    const problem = liveSwitchProblem(state, book.routineId, at);
    if (!problem) {
      setMoney({ step: 'asked' });
      return;
    }
    // Only the clean practice sessions hold it: offer the live account already traded.
    const existing = liveSwitchProblem(state, book.routineId, at, true);
    if (!existing) {
      setMoney({ step: 'gated', why: problem });
      return;
    }
    setMoney(null);
    setError(existing === EXISTING_ACCOUNTS_LINE ? `${problem} ${existing}` : problem);
  };
  const answer = async (setAside: boolean) => {
    if (!setAside) {
      setMoney({ step: 'no' });
      return;
    }
    const at = new Date().toISOString();
    if (await change((s) => setLiveTrading(s, book.routineId, true, at, true, existing)))
      setMoney(null);
  };
  const save = async () => {
    try {
      const limits = parseLimits(text, profile.limits);
      // The instrument is all three or none.
      const named = name.trim();
      const typed = [named, pointValue.trim(), tick.trim()].filter(Boolean).length;
      if (typed && typed < 3)
        throw new Error(
          'Enter the instrument, its point value and its tick, or leave all three blank.',
        );
      const instrument = typed
        ? {
            name: named,
            pointValue: amount(pointValue, 'the point value')!,
            tick: amount(tick, 'the tick')!,
          }
        : undefined;
      const maxContracts = contracts.trim() ? parseContracts(contracts) : null;
      if (contracts.trim() && maxContracts === null)
        throw new Error(
          `Enter contracts as a whole number from 1 to ${MAX_CONTRACTS}, or leave it blank.`,
        );
      const nextRisk = {
        tradeRisk: dollars(tradeRisk, 'the risk per trade'),
        maxContracts,
        thesisRisk: dollars(thesisRisk, 'the thesis budget'),
        dailyLoss: dollars(dailyLoss, 'the session max loss'),
      };
      const anyRisk = Object.values(nextRisk).some((v) => v !== null);
      const copies = count(accounts, 1, MAX_ACCOUNTS, 'accounts') ?? 1;
      const minutes = count(
        cooldown,
        COOLDOWN_MINUTES.min,
        COOLDOWN_MINUTES.max,
        'cooldown minutes',
      );
      const cap = count(entries, 1, MAX_ENTRIES, 'entries per session');
      const run = count(lossRun, 1, MAX_LOSS_RUN, 'losses in a row');
      const totalLoss = dollars(total, 'the total across accounts');
      const flat = flatByTime(flatBy);
      const costs = {
        commission: dollars(commission, 'the commission', true),
        slippageTicks: count(slippage, 0, 100, 'slippage ticks'),
      };
      const anyCost = costs.commission !== null || costs.slippageTicks !== null;
      // Cleared fields clear the instrument; risk limits once set stay as a record of nulls.
      const rest = { ...profile };
      delete rest.instrument;
      delete rest.risk;
      delete rest.costs;
      delete rest.cooldownMinutes;
      delete rest.maxEntries;
      delete rest.maxLossRun;
      delete rest.dailyLossTotal;
      delete rest.flatBy;
      const ok = await change((s) =>
        saveLimits(
          s,
          book.routineId,
          {
            ...rest,
            limits,
            accounts: copies,
            ...(instrument && { instrument }),
            ...((anyRisk || risk) && { risk: nextRisk }),
            ...((anyCost || profile.costs) && { costs }),
            ...(minutes !== null && { cooldownMinutes: minutes }),
            ...(cap !== null && { maxEntries: cap }),
            ...(run !== null && { maxLossRun: run }),
            ...(totalLoss !== null && { dailyLossTotal: totalLoss }),
            ...(flat !== undefined && { flatBy: flat }),
          },
          new Date().toISOString(),
        ),
      );
      if (ok) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the limits.');
    }
  };
  return (
    <Sheet
      title="Your limits"
      visible
      close={close}
      footer={
        <>
          {/* The money question and its No lines sit here, pinned above Save limits, so a tap on
              the switch is answered on screen at any scroll, and VoiceOver reads them as they
              appear. */}
          {money?.step === 'gated' && (
            <View
              testID="live-gated"
              accessibilityLiveRegion="polite"
              aria-live="polite"
              style={{ gap: 8 }}>
              <Text style={type.body}>{money.why}</Text>
              <Button
                secondary
                title="I already trade one live account"
                onPress={() => setMoney({ step: 'existing' })}
              />
            </View>
          )}
          {money?.step === 'existing' && (
            <View
              testID="existing-account"
              accessibilityLiveRegion="polite"
              aria-live="polite"
              style={{ gap: 8 }}>
              <Text style={type.body}>{EXISTING_ACCOUNT_LINE}</Text>
              <Pair>
                <Button
                  secondary
                  title="Yes, confirm"
                  onPress={() => {
                    setExisting(true);
                    setMoney({ step: 'asked' });
                  }}
                />
                <Button secondary title="Not now" onPress={() => setMoney(null)} />
              </Pair>
            </View>
          )}
          {money?.step === 'asked' && (
            <View
              testID="money-question"
              accessibilityLiveRegion="polite"
              aria-live="polite"
              style={{ gap: 8 }}>
              <Text style={type.body}>{MONEY_QUESTION}</Text>
              <Pair>
                <Button secondary title="Yes, set aside" onPress={() => void answer(true)} />
                <Button secondary title="No" onPress={() => void answer(false)} />
              </Pair>
            </View>
          )}
          {money?.step === 'no' && (
            <View
              testID="money-no"
              accessibilityLiveRegion="polite"
              aria-live="polite"
              style={{ gap: 4 }}>
              <Text style={type.body}>{MONEY_NO_LINE}</Text>
              <Text style={type.caption}>{MONEY_INFO_LINE}</Text>
            </View>
          )}
          {error && (
            <Text accessibilityRole="alert" style={styles.alert}>
              {error}
            </Text>
          )}
          <Button title="Save limits" onPress={() => void save()} />
        </>
      }>
      <View style={[styles.panel, { gap: 4 }]}>
        <Text style={{ ...type.caption, color: palette.label }}>
          Set outside the session: a session locks them when it starts.
        </Text>
        <Text style={type.caption}>
          A lower limit applies at once; a higher one waits for the next candle&apos;s session, even
          when saved before today&apos;s starts.
        </Text>
        <Text style={type.caption}>
          Dollars are per account. A blank limit holds every entry until it is set.
        </Text>
      </View>
      {raise && (
        <Text testID="waiting-raise" style={type.caption}>
          {raise}
        </Text>
      )}
      <Section title="Risk" />
      <Pair>
        <Field
          label="Risk per trade · $"
          value={tradeRisk}
          onChange={setTradeRisk}
          decimal
          hint="Fixed: the stop sets the size."
        />
        <Field label="Thesis budget · $" value={thesisRisk} onChange={setThesisRisk} decimal />
      </Pair>
      <Pair>
        <Field label="Session max loss · $" value={dailyLoss} onChange={setDailyLoss} decimal />
        <Field label="Contracts at most" value={contracts} onChange={setContracts} numeric />
      </Pair>
      <Field
        label="Total across accounts · $"
        value={total}
        onChange={setTotal}
        decimal
        hint="Optional. The session stops at this or the session max loss × accounts, whichever is less."
      />
      <Pair>
        <Field
          label="Accounts"
          value={accounts}
          onChange={setAccounts}
          numeric
          hint="Each trade is copied to all. More after clean live sessions."
        />
        <Field
          label="Cooldown · minutes"
          value={cooldown}
          onChange={setCooldown}
          numeric
          hint={`${COOLDOWN_MINUTES.min} to ${COOLDOWN_MINUTES.max}.`}
        />
      </Pair>
      <Section title="Session" />
      <Pair>
        <Field
          label="Entries per session"
          value={entries}
          onChange={setEntries}
          numeric
          hint={`1 to ${MAX_ENTRIES}. Copies to every account are one entry; a partial exit is none.`}
        />
        <Field
          label="Losses in a row"
          value={lossRun}
          onChange={setLossRun}
          numeric
          hint={`1 to ${MAX_LOSS_RUN}. They end the session.`}
        />
      </Pair>
      <Text style={type.caption}>
        Either one ends the session until the next 9:30 AM New York window. A new thesis resets
        neither.
      </Text>
      <Field
        label="Flat by · New York time"
        value={flatBy}
        onChange={setFlatBy}
        time
        placeholder="HH:MM"
        hint="Optional, as your firm's rules require. In a live session: a warning 15 minutes before, no new entries after it that day, and an open trade asks for its outcome."
      />
      <Section title="Costs · estimates per contract" />
      <Pair>
        <Field
          label="Commission · $ round trip"
          value={commission}
          onChange={setCommission}
          decimal
        />
        <Field label="Slippage · ticks" value={slippage} onChange={setSlippage} numeric />
      </Pair>
      <Text style={type.caption}>Left blank, risk is shown without costs, and says so.</Text>
      <Section title="Instrument" />
      <Field label="Instrument" value={name} onChange={setName} maxLength={INSTRUMENT_NAME} name />
      <Pair>
        <Field label="Point value · $" value={pointValue} onChange={setPointValue} decimal />
        <Field label="Tick" value={tick} onChange={setTick} decimal />
      </Pair>
      <Section title="Live trading" />
      <Text style={type.caption}>
        {live
          ? liveByExistingAccount(profile)
            ? `On for one live account you already trade, confirmed ${displayDate(profile.existingAccountOn!)}: a session starts live only when nothing pauses it.`
            : 'On: a session starts live only when nothing pauses it.'
          : `${LIVE_OFF_LINE} It can be turned on only between sessions, never during a cooldown, a stop or a pause.`}
      </Text>
      <Text testID="before-live" style={type.caption}>
        {BEFORE_LIVE_LINE}
      </Text>
      <View testID="live-gates" style={{ gap: 2 }}>
        {gates.map((line) => (
          <Text key={line} style={type.caption}>
            {line}
          </Text>
        ))}
      </View>
      <Toggle
        title="Live trading"
        detail={live ? 'On' : 'Off'}
        value={live}
        onChange={() => void switchLive()}
      />
      <Text style={type.caption}>{APP_LEVEL_LINE}</Text>
      <Section title="Notes" />
      <Field
        label="Notes · not checked by the app"
        value={text}
        onChange={setText}
        multiline
        hint="One per line, as you would say it: “Daily loss: $80 per account”. Shown, never enforced."
      />
    </Sheet>
  );
}
