import { router } from 'expo-router';
import { ColorValue, Text, View } from 'react-native';
import { RuleBook, displayDate as displayCandle } from '../domain/model';
import { candleDate, gexLocks, nyClockText } from '../domain/market-clock';
import { profitLimit, tradingBook } from '../domain/trading';
import {
  AFTER_ENTRY,
  CHOP_RULE,
  CORE_RULES,
  DAILY_RULES,
  NEW_ENTRY_NEEDS,
  RISK_PRINCIPLES,
} from '../domain/trading-rules';
import { useApp } from '../state/app-state';
import { BIAS_STRIP, TINT_CAPTION } from '../ui/bias-strip';
import { StatusBand, openStrategy } from '../ui/cockpit';
import { Page, SectionLabel, styles } from '../ui/components';
import { Disclosure, LinkButton } from '../ui/controls';
import { Panel } from '../ui/trading-parts';
import { useLiveStatus } from '../ui/use-live';
import { depth, fonts, market, palette, radius, type } from '../ui/theme';

// Rules & GEX: the trading reference page, one tap from the cockpit. The cockpit's status (the
// same one, from `tradeStatus`), the GEX lock times, the core rules, what comes after an entry and
// after a stopped idea, the fifteen daily rules and the risk rules. Reference only: the plan, the
// setup and the entries are on the cockpit. Life OS never places, allows or blocks a trade at a
// broker and cannot see an account.

/** A core rule card: the rule in sentence case under a short mark in its group color. */
function RuleCard({ rule, color }: { rule: string; color: ColorValue }) {
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: 150,
        gap: 8,
        padding: 14,
        borderRadius: radius.tile,
        backgroundColor: palette.surface,
        ...depth.card,
      }}>
      <View
        aria-hidden
        style={{ width: 22, height: 4, borderRadius: radius.capsule, backgroundColor: color }}
      />
      <Text style={{ ...fonts.semibold, fontSize: 15, lineHeight: 20, color: palette.label }}>
        {rule}
      </Text>
      {rule === 'Chop = leave it' && <Text style={type.caption}>{CHOP_RULE}</Text>}
    </View>
  );
}

/** The core rules' groups: thesis in blue, entry in amber, the trade in green, red last. */
function ruleColor(i: number): ColorValue {
  return i < 2 ? market.gex : i < 7 ? market.amber : i < 10 ? market.bull : market.bear;
}

export default function RulesScreen() {
  const { state } = useApp();
  const book = tradingBook(state);
  if (!book)
    return (
      <Page title="Rules & GEX" back="/trading">
        <Text style={styles.muted}>Set up Trading discipline first, on the Trading page.</Text>
        <LinkButton title="Open Trading" onPress={() => router.replace('/trading')} />
      </Page>
    );
  return <Rules book={book} />;
}

function Rules({ book }: { book: RuleBook }) {
  const profile = book.trading!;
  // The same status as the cockpit, from the same records and clock: never a second reading.
  const { ctx, status } = useLiveStatus(book);
  return (
    <Page
      title="Rules & GEX"
      back="/trading"
      top={
        <Text style={styles.label}>
          Daily candle · {displayCandle(candleDate(ctx.now))} · New York {nyClockText(ctx.now)}
        </Text>
      }>
      <StatusBand
        title={status.title}
        reason={status.reason}
        next={status.next}
        tone={status.tone}
        basis={status.basis}
        practice={status.practice}
        event={status.event}
      />
      <View style={styles.section}>
        <SectionLabel title="GEX locks · New York time" />
        <View testID="gex-window" style={{ gap: 4 }}>
          {gexLocks(ctx.candle).map((lock) => (
            <Text key={lock.id} style={type.small}>
              {`${lock.title} · ${lock.hours}`}
            </Text>
          ))}
          <Text style={type.caption}>
            Session-locked GEX at 6 PM and 9:30 AM, valid for 6.5 hours. A plan made under the 6 PM
            lock is confirmed with one tap before new entries in the 9:30 AM window. The levels live
            on your chart; exchange holidays are not known here.
          </Text>
        </View>
        <LinkButton
          tone="pill"
          title="My strategy"
          label="Open My Trading Strategy"
          onPress={openStrategy}
        />
      </View>

      <View style={styles.section}>
        <SectionLabel title="Core rules" />
        <View testID="core-rules" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {CORE_RULES.map((rule, i) => (
            <RuleCard key={rule} rule={rule} color={ruleColor(i)} />
          ))}
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <View style={{ flexGrow: 1, flexBasis: 220 }}>
          <Panel look={{ color: market.bull, deep: market.bullTint, edge: market.bullEdge }}>
            <Text style={{ ...type.meta, color: market.bull }}>After I enter</Text>
            {AFTER_ENTRY.map((line) => (
              <Text key={line} style={TINT_CAPTION}>
                · {line}
              </Text>
            ))}
          </Panel>
        </View>
        <View style={{ flexGrow: 1, flexBasis: 220 }}>
          <Panel look={BIAS_STRIP.none}>
            <Text style={{ ...type.meta, color: market.amber }}>A stopped idea</Text>
            <Text style={TINT_CAPTION}>Not re-entered automatically. A new trade requires:</Text>
            {NEW_ENTRY_NEEDS.map((line) => (
              <Text key={line} style={TINT_CAPTION}>
                · {line}
              </Text>
            ))}
          </Panel>
        </View>
      </View>

      <Disclosure title="My daily trading rules" summary={`${DAILY_RULES.length} rules`}>
        <View testID="daily-rules" style={{ gap: 14 }}>
          {DAILY_RULES.map((rule) => (
            <View key={rule.n} style={{ gap: 4 }}>
              <Text style={{ ...type.item, ...fonts.semibold }}>
                {rule.n}. {rule.title}
              </Text>
              {rule.lines.map((line) => (
                <Text key={line} style={type.caption}>
                  {line}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </Disclosure>

      <Disclosure title="Risk rules" summary="limits and the account set">
        <View style={{ gap: 8 }}>
          <Text style={{ ...type.item, ...fonts.semibold }}>
            “I am not trading to recover losses, hit a profit target, or force money today.”
          </Text>
          {/* No profit ceiling or dollar target on the live screen: only the profit-target rule below. */}
          {profile.limits
            .filter((l) => !profitLimit(l))
            .map((l) => (
              <View key={l.id} accessible>
                <Text style={type.caption}>{l.label}</Text>
                <Text style={{ ...type.item, ...fonts.semibold }}>{l.value}</Text>
              </View>
            ))}
          {RISK_PRINCIPLES.map((p) => (
            <Text key={p} style={type.caption}>
              · {p}
            </Text>
          ))}
          <Text style={type.caption}>Rules you wrote, not advice. Not checked at a broker.</Text>
        </View>
      </Disclosure>

      <Text style={type.caption}>
        Each candle&apos;s trading session (the plan, the theses, the attempts, cooldowns and stops)
        is kept in your saved data and in backups. Restoring an older backup brings back its older
        sessions: the record is tamper-evident, not tamper-proof.
      </Text>
    </Page>
  );
}
