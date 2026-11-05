# 8. No state, chart or schema library

Status: accepted

## Context

Libraries for global state, charts and runtime validation are common defaults. Each adds code to update, bundle size, and an API to learn, and each would sit at the center of the app.

## Decision

- **State:** one React context (`AppProvider`) and the serialized save queue ([ADR 6](0006-sqlite-and-a-serialized-save-queue.md)). Components that only start changes read `useSave()`, so rows on Today do not re-render for each other's saves.
- **Charts:** drawn by hand with views (`src/ui/line-chart.tsx`, `bar-chart.tsx`, `chart-scale.ts`). They show recorded values only, never interpolate, and support press-and-drag reading and a list view for VoiceOver.
- **Validation:** hand-written decoders (`decodeState` in `src/domain/data.ts`, `records.ts`, `trading-live-model.ts`). They validate and upgrade in one pass and return typed errors the UI can show.

## Consequences

- The domain layer has no runtime dependency at all, which keeps it deterministic and fast to test.
- The decoders are longer than a schema declaration would be, and adding a field means editing its validator by hand. The trade is full control over upgrade and error behavior, which matters more here because the data never leaves the phone.
- Charts cover exactly the cases the app needs (line and column, one series or two) and nothing more.
