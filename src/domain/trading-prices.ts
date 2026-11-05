import { PRICE_MAX } from './records';

// Prices on the trading cockpit: the plan's objective and invalidation, the mapped GEX area, and an
// entry's planned entry and stop, all typed in by the user from their own chart. Life OS never
// reads a price from a market or a broker. Prices are kept as the decimal numbers typed, never as
// a count of ticks, so a later change of the tick size never reinterprets a saved plan. Formatting
// is done here without Intl, as in market-clock.ts, so it reads the same on every device.

/** Whole digits grouped by thousands: "25040" → "25,040". */
function grouped(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "25,040", "25,040.25" or "0.5": a price or a point distance, with no trailing zeros. */
export function priceText(n: number): string {
  const [whole, fraction] = Math.abs(n)
    .toFixed(6)
    .replace(/\.?0+$/, '')
    .split('.');
  const sign = n < 0 && (whole !== '0' || fraction) ? '-' : '';
  return `${sign}${grouped(whole)}${fraction ? `.${fraction}` : ''}`;
}

/** "$120" or "$37.50": a dollar amount, to the cent. */
export function dollarText(n: number): string {
  const cents = Math.round(Math.abs(n) * 100);
  const sign = n < 0 && cents ? '-' : '';
  const whole = grouped(String(Math.floor(cents / 100)));
  return `${sign}$${whole}${cents % 100 ? `.${String(cents % 100).padStart(2, '0')}` : ''}`;
}

/** A price as typed ("25,040.25", "25040"), or null when it is not one. Commas are ignored. */
export function parsePrice(text: string): number | null {
  const plain = text.trim().replace(/[,\s]/g, '');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(plain)) return null;
  const value = Number(plain);
  return Number.isFinite(value) ? value : null;
}

/** Contracts as typed: a whole number from 1 to 99, or null. */
export function parseContracts(text: string): number | null {
  const plain = text.trim();
  if (!/^\d{1,2}$/.test(plain)) return null;
  const value = Number(plain);
  return value >= 1 ? value : null;
}

/** Whether a price sits on the tick: 25,040.25 on 0.25, never 25,040.1. */
export function onTick(price: number, tick: number): boolean {
  const steps = price / tick;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

/** "the normal target" → "The normal target". */
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * The first thing wrong with one typed price, or null: missing, not above zero, too large, or off
 * the tick when the tick is known.
 */
export function priceProblem(
  price: number | null,
  what: string,
  tick: number | null,
): string | null {
  if (price === null || !Number.isFinite(price) || price <= 0 || price > PRICE_MAX)
    return `Enter ${what} as a price above zero.`;
  if (tick !== null && !onTick(price, tick))
    return `${capital(what)} ${priceText(price)} is not on the ${priceText(tick)} tick.`;
  return null;
}

/**
 * The first thing wrong with a target (its objective; `target` names it, "the normal target" by
 * default) and invalidation for the side the bias allows, or null: each a price above zero on the
 * tick (when the instrument's tick is set), and for a long the target above the invalidation, for
 * a short below it.
 */
export function thesisPriceProblem(
  direction: 'long' | 'short',
  objective: number | null,
  invalidation: number | null,
  tick: number | null,
  target = 'the normal target',
): string | null {
  const problem =
    priceProblem(objective, target, tick) ?? priceProblem(invalidation, 'the invalidation', tick);
  if (problem) return problem;
  const Target = target[0].toUpperCase() + target.slice(1);
  if (objective === invalidation) return `${Target} and the invalidation cannot be the same price.`;
  if (direction === 'long' && objective! < invalidation!)
    return `For a long, ${target} must be above the invalidation.`;
  if (direction === 'short' && objective! > invalidation!)
    return `For a short, ${target} must be below the invalidation.`;
  return null;
}
