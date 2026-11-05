# 10. One trading status from a priority table

Status: accepted

## Context

The trading feature is a rules-based session checklist for a trader who wants to keep a written process: a plan before the session, a fixed dollar risk per trade, cooldowns after a rushed moment or a loss, and a review afterwards. It never connects to a broker or reads a market; every figure is the trader's own report. The built-in daily rules and the three named setups describe one higher-timeframe method around options-gamma (GEX) levels, and the cockpit's typed checks follow them; My Trading Strategy is where the trader writes their own method, starting from a template of five prompts. The terms are explained in [FEATURES.md](../FEATURES.md#trading). Several screens show where a session stands (the live cockpit, preparation, Today's row, the reference page and the review), and if each screen decided that for itself they would drift apart.

## Decision

- `tradeStatus` in `src/domain/trading-status.ts` is the one status every trading screen reads. It walks `STATUS_TABLE` in priority order, from "the session cannot be read" through open positions, stops, unknown exposure, cooldowns and practice-only, to "setup checks complete". The first row that holds wins. Screens render the status and never decide it.
- Each status carries its basis (`app` when recorded facts and the clock hold it, `report` when it rests on the trader's own reading), a reason, a next action and a tone.
- No status ever says a trade is approved, and no screen calls an app-level restriction a broker lockout.
- Every trading write goes through `putTradingSession` and the strict decoder, so a restriction lives in the saved session, never in a screen.
- An unknown loss is never counted as zero. A new thesis never resets losses, cooldowns or stops. Live trading is off until the user turns it on in Your limits, and a restore always leaves it off.
- The clean-session streak is scored from reviewed sessions, never from profit.

## Consequences

- Every row of the table is tested true and false, including its missing-data behavior, and the screens cannot disagree.
- Restrictions are tamper-evident, not tamper-proof: restoring an older backup or moving the phone's clock can roll them back. The broker's own controls are the ones that can stop an order, and the app says so.
