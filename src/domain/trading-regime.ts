import { Regime } from './model';
import { NOT_CLASSIFIED, regimeCard } from './trading-rules';

// The HTF candle classification an earlier build saved on a session: the user's own read of the
// daily or 4-day candle, a range, an expansion candidate or a confirmed expansion, which needs all
// three pieces of evidence. Read for the history and the review; nothing here reads a market.

/** Whether a classification is a confirmed expansion with its evidence. */
export function confirmedExpansion(regime: Regime | null | undefined): boolean {
  return (
    regime?.kind === 'confirmed' &&
    !!regime.evidence &&
    regime.evidence.displacement &&
    regime.evidence.structure &&
    regime.evidence.room
  );
}

/** The header's classification label: RANGE, EXPANSION CANDIDATE, EXPANSION CONFIRMED. */
export function regimeLabel(regime: Regime | null | undefined): string {
  return regime ? regimeCard(regime.kind).label : NOT_CLASSIFIED;
}
