import { useState } from 'react';
import { Text, View } from 'react-native';
import { TradingProfile, displayDate } from '../domain/model';
import { DailyBias, directional } from '../domain/trading';
import {
  LiveContext,
  PlanDraft,
  carriedPlan,
  confirmPlan,
  eventText,
  lockSession,
  planDraftProblem,
  profileLimits,
  savePlan,
  setUnclear,
} from '../domain/trading-live';
import { TradingPlan, WHERE_MAX, whereText } from '../domain/trading-live-model';
import { dollarText, parsePrice, priceText } from '../domain/trading-prices';
import { effectiveSettings, waitingRaiseLine } from '../domain/trading-safeguards';
import { Field, LinkButton } from './components';
import { NEUTRAL } from './cockpit';
import { BIAS_LOOK, BigChoice, Bold, ChoiceRow, CockpitButton } from './trading-parts';
import { LiveWrite } from './use-live';
import { depth, fonts, palette, radius, type } from './theme';

// Preparation: one screen before the session. The HTF plan (bullish, bearish or unclear; all day
// or conditional on a move into the area first), one line on why, the target (a second one
// optional), the invalidation and an optional label for the area; an optional major event. The
// previous candle's plan comes back to confirm with one tap. The limits are read here and edited
// in Your limits; I'M READY starts the session. No GEX prices are asked: they live on the chart.

const ARROW: Record<DailyBias, string> = { bullish: '▲', bearish: '▼', unclear: '–' };

/**
 * "$100 per trade · $150 per thesis · $300 session · 5 contracts · 1 account · costs not set", as
 * they hold on `candle` (a raise saved on it waits for the next candle).
 */
export function limitsLine(profile: TradingProfile, candle: string): string {
  const { limits, missing } = profileLimits(profile, candle);
  if (!limits) return `Not set: ${missing.join(', ')}. Entries are blocked until they are.`;
  const costs =
    limits.commission === null && limits.slippageTicks === null
      ? 'costs not set'
      : `costs ${limits.commission === null ? '—' : dollarText(limits.commission)} + ${limits.slippageTicks ?? 0} ticks`;
  return `${dollarText(limits.tradeRisk)} per trade · ${dollarText(limits.thesisRisk)} per thesis · ${dollarText(limits.dailyLoss)} session · ${limits.maxContracts} contracts · ${limits.accounts} account${limits.accounts === 1 ? '' : 's'} · ${costs}`;
}

/** "At most 3 entries · 2 losses in a row end it · $400 at most across accounts". */
export function capsLine(profile: TradingProfile, candle: string): string {
  const e = effectiveSettings(profile, candle);
  const total =
    e.dailyLossTotal === null ? '' : ` · ${dollarText(e.dailyLossTotal)} at most across accounts`;
  return `Session: at most ${e.maxEntries} entr${e.maxEntries === 1 ? 'y' : 'ies'} · ${e.maxLossRun} loss${e.maxLossRun === 1 ? '' : 'es'} in a row end${e.maxLossRun === 1 ? 's' : ''} it${total}`;
}

/** The plan as saved or carried, read back in a few lines. */
function PlanCard({
  bias,
  plan,
  candle,
  title,
}: {
  bias: DailyBias | null;
  plan: Pick<TradingPlan, 'why' | 'target' | 'invalidation' | 'where' | 'conditional'> & {
    target2?: number | null;
    event?: TradingPlan['event'] | null;
  };
  candle: string;
  title?: string;
}) {
  const look = BIAS_LOOK[bias ?? 'none'];
  const side = bias ? `${ARROW[bias]} ${bias[0].toUpperCase()}${bias.slice(1)}` : 'Not set';
  const where = whereText(plan.where);
  return (
    <View
      testID="plan-card"
      style={{
        gap: 8,
        padding: 16,
        borderRadius: radius.card,
        backgroundColor: palette.surface,
        ...depth.card,
      }}>
      {title && <Text style={type.meta}>{title}</Text>}
      <View
        style={{
          alignSelf: 'flex-start',
          paddingHorizontal: 12,
          paddingVertical: 4,
          borderRadius: radius.capsule,
          borderWidth: 1.5,
          borderColor: look.edge,
          backgroundColor: look.deep,
        }}>
        <Bold
          text={`${side} · ${plan.conditional ? `into ${where} first` : 'all day'}`}
          color={look.color}
          size={15}
        />
      </View>
      <Text style={type.body}>{plan.why}</Text>
      <Text style={{ ...fonts.figure, fontSize: 17, lineHeight: 22, color: palette.label }}>
        {`Target ${priceText(plan.target)}${plan.target2 ? ` · then ${priceText(plan.target2)}` : ''} · invalidation ${priceText(plan.invalidation)}`}
      </Text>
      <Text style={type.caption}>{`Where: ${where}`}</Text>
      {plan.event && (
        <Text style={type.caption}>
          {`Major event: ${eventText(plan.event, candle)} · practice only`}
        </Text>
      )}
    </View>
  );
}

type Draft = {
  bias: DailyBias | null;
  conditional: boolean;
  why: string;
  target: string;
  target2: string;
  invalidation: string;
  where: string;
  event: { name: string; time: string } | null;
  carriedFrom?: string;
};

const text = (n: number | null | undefined) => (n == null ? '' : String(n));

function draftOf(bias: DailyBias | null, plan: PlanDraft | TradingPlan | null): Draft {
  return {
    bias,
    conditional: plan?.conditional ?? false,
    why: plan?.why ?? '',
    target: text(plan?.target),
    target2: text(plan?.target2),
    invalidation: text(plan?.invalidation),
    where: plan?.where ?? '',
    event: plan?.event ? { ...plan.event } : null,
    ...(plan && 'carriedFrom' in plan && plan.carriedFrom && { carriedFrom: plan.carriedFrom }),
  };
}

/** The draft as the domain reads it, for a side. */
function planDraft(d: Draft, bias: 'bullish' | 'bearish'): PlanDraft {
  return {
    bias,
    why: d.why,
    target: parsePrice(d.target),
    target2: d.target2.trim() ? parsePrice(d.target2) : null,
    invalidation: parsePrice(d.invalidation),
    where: d.where,
    conditional: d.conditional,
    event: d.event,
    ...(d.carriedFrom && { carriedFrom: d.carriedFrom }),
  };
}

/** The plan form: everything typed here, saved with one tap. */
function PlanForm({
  ctx,
  initial,
  write,
  done,
}: {
  ctx: LiveContext;
  initial: Draft;
  write: LiveWrite;
  done: () => void;
}) {
  const [d, setD] = useState(initial);
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const tick = ctx.profile.instrument?.tick ?? null;
  const directionalBias = directional(d.bias) ? d.bias : null;
  const problem = !d.bias
    ? 'Choose the HTF plan: bullish, bearish or unclear.'
    : directionalBias
      ? planDraftProblem(planDraft(d, directionalBias), tick)
      : null;
  const save = () =>
    void write((s, at) =>
      directionalBias
        ? savePlan(s, ctx.routineId, planDraft(d, directionalBias), at)
        : setUnclear(s, ctx.routineId, at),
    ).then((ok) => ok && done());
  return (
    <View testID="plan-form" style={{ gap: 12 }}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="HTF plan"
        style={{ flexDirection: 'row', gap: 8 }}>
        {(['bullish', 'bearish', 'unclear'] as const).map((b) => {
          const on = d.bias === b;
          const look = BIAS_LOOK[b];
          // The arrow over the word, so a word never breaks across lines on the narrowest phone.
          const ink = b === 'unclear' ? palette.label : look.color;
          return (
            <View key={b} style={{ flex: 1 }}>
              <BigChoice
                label={`HTF ${b}`}
                on={on}
                look={look}
                minHeight={64}
                neutral={b === 'unclear'}
                onPress={() => set({ bias: b })}>
                <Text
                  maxFontSizeMultiplier={1.2}
                  style={{ ...fonts.bold, fontSize: 15, lineHeight: 18, color: ink }}>
                  {on ? `✓ ${ARROW[b]}` : ARROW[b]}
                </Text>
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.2}
                  style={{ ...fonts.semibold, fontSize: 15, lineHeight: 20, color: ink }}>
                  {`${b[0].toUpperCase()}${b.slice(1)}`}
                </Text>
              </BigChoice>
            </View>
          );
        })}
      </View>
      {d.bias === 'unclear' && (
        <Text style={type.caption}>
          If I cannot explain the expected HTF move: no trade. A no-trade day is fine.
        </Text>
      )}
      {directionalBias && (
        <>
          <ChoiceRow
            label="All day or conditional"
            options={[
              { id: 'all', title: 'All day', label: `${directionalBias} for the rest of the day` },
              {
                id: 'cond',
                title: 'Conditional',
                label: 'A move into my area first, then look for my side',
              },
            ]}
            value={d.conditional ? 'cond' : 'all'}
            look={NEUTRAL}
            onChange={(v) => set({ conditional: v === 'cond' })}
          />
          <Field
            label="Why · one line"
            value={d.why}
            onChange={(v) => set({ why: v })}
            wrap
            name
            maxLength={160}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field label="Target" value={d.target} onChange={(v) => set({ target: v })} decimal />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Invalidation"
                value={d.invalidation}
                onChange={(v) => set({ invalidation: v })}
                decimal
              />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field
                label="2nd target · optional"
                value={d.target2}
                onChange={(v) => set({ target2: v })}
                decimal
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Where · optional"
                value={d.where}
                onChange={(v) => set({ where: v })}
                placeholder="My area"
                maxLength={WHERE_MAX}
              />
            </View>
          </View>
          {d.event ? (
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 3 }}>
                  <Field
                    label="Major event"
                    value={d.event.name}
                    onChange={(v) => set({ event: { ...d.event!, name: v } })}
                    placeholder="FOMC"
                    maxLength={WHERE_MAX}
                  />
                </View>
                <View style={{ flex: 2 }}>
                  <Field
                    label="NY time"
                    value={d.event.time}
                    onChange={(v) => set({ event: { ...d.event!, time: v } })}
                    placeholder="14:00"
                    time
                  />
                </View>
              </View>
              <Text style={type.caption}>
                With a major event the session is practice only. Life OS checks no calendar.
              </Text>
              <LinkButton title="No major event" onPress={() => set({ event: null })} />
            </View>
          ) : (
            <LinkButton
              title="+ Major event today"
              label="Add a major event today"
              onPress={() => set({ event: { name: '', time: '' } })}
            />
          )}
        </>
      )}
      <CockpitButton
        title={directionalBias || !d.bias ? 'Save plan' : 'Save: no trade'}
        look={NEUTRAL}
        disabled={!!problem}
        needs={problem}
        onPress={save}
      />
    </View>
  );
}

/**
 * Preparation, before the session: the plan (carried with one Confirm, or typed), the limits as
 * set, and I'M READY once nothing holds the start. `ready` is the status allowing the start.
 */
export function Preparation({
  ctx,
  ready,
  write,
  openLimits,
}: {
  ctx: LiveContext;
  ready: boolean;
  write: LiveWrite;
  openLimits: () => void;
}) {
  const s = ctx.session;
  const [editing, setEditing] = useState(false);
  const carried = carriedPlan(ctx);
  const stopped = !!s.doneAt || ctx.reviewed;
  const form = !stopped && (editing || (!s.plan && !carried && s.bias !== 'unclear'));
  return (
    <View testID="preparation" style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={type.cardTitle}>
        Preparation
      </Text>
      {form ? (
        <PlanForm
          key={s.plan?.at ?? s.biasAt ?? 'new'}
          ctx={ctx}
          initial={draftOf(s.bias ?? carried?.bias ?? null, s.plan ?? carried)}
          write={write}
          done={() => setEditing(false)}
        />
      ) : carried && !s.plan ? (
        <View style={{ gap: 8 }}>
          <PlanCard
            bias={carried.bias}
            plan={{ ...carried, target: carried.target!, invalidation: carried.invalidation! }}
            candle={ctx.candle}
            title={`Carried from ${displayDate(carried.carriedFrom!)} — confirm or change`}
          />
          {!stopped && (
            <>
              <CockpitButton
                title="Confirm plan"
                label={`Confirm the plan carried from ${displayDate(carried.carriedFrom!)}`}
                look={NEUTRAL}
                onPress={() => void write((st, at) => savePlan(st, ctx.routineId, carried, at))}
              />
              <LinkButton tone="pill" title="Change it" onPress={() => setEditing(true)} />
            </>
          )}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {s.plan && directional(s.bias) ? (
            <PlanCard bias={s.bias} plan={s.plan} candle={ctx.candle} />
          ) : (
            <Text style={type.body}>
              {s.bias === 'unclear' ? 'HTF unclear: no trade today.' : 'No plan for this candle.'}
            </Text>
          )}
          {!stopped && !s.startedAt && (
            <LinkButton
              tone="pill"
              title={s.bias === 'unclear' ? 'Change the HTF plan' : 'Change the plan'}
              onPress={() => setEditing(true)}
            />
          )}
        </View>
      )}
      <View
        testID="prep-limits"
        style={{
          gap: 4,
          padding: 16,
          borderRadius: radius.card,
          backgroundColor: palette.surface,
          ...depth.card,
        }}>
        <Text style={type.heading}>Your limits</Text>
        <Text style={type.footnote}>Set outside the session, locked when it starts.</Text>
        <Text style={{ ...type.caption, color: palette.label, paddingTop: 4 }}>
          {limitsLine(ctx.profile, ctx.candle)}
        </Text>
        <Text style={type.caption}>{capsLine(ctx.profile, ctx.candle)}</Text>
        {waitingRaiseLine(ctx.profile, ctx.candle) && (
          <Text style={type.caption}>{waitingRaiseLine(ctx.profile, ctx.candle)}</Text>
        )}
        <LinkButton
          tone="pill"
          title="Change limits"
          label="Edit your limits"
          onPress={openLimits}
        />
      </View>
      {!form && !stopped && s.plan && directional(s.bias) && (
        <View style={{ gap: 4 }}>
          <CockpitButton
            testID="im-ready"
            title="I'm ready"
            label="I'm ready: calm, the loss accepted, no pressure. Start the session."
            look={NEUTRAL}
            disabled={!ready}
            needs="The status above says what holds the start."
            onPress={() => void write((st, at) => lockSession(st, ctx.routineId, at))}
          />
          <Text style={type.caption}>
            Calm, the loss accepted, no pressure to earn. The plan and the limits lock now.
          </Text>
        </View>
      )}
    </View>
  );
}

/** "Plan from the 6 PM GEX — still valid now?": one tap, nothing retyped. */
export function ConfirmPlanButton({ routineId, write }: { routineId: string; write: LiveWrite }) {
  return (
    <CockpitButton
      testID="confirm-plan"
      title="Plan still valid"
      label="Confirm the plan for this GEX lock"
      look={NEUTRAL}
      onPress={() => void write((s, at) => confirmPlan(s, routineId, at))}
    />
  );
}
