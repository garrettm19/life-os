# Design decisions

Short records of the choices that shape the code, each with its context and consequences. A decision changes through a new or amended record in the same pull request as the code.

| #                                               | Decision                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| [1](0001-local-first-no-backend.md)             | Local-first, with no backend                                           |
| [2](0002-ios-only-web-for-tests.md)             | iOS is the only native target; the web build is for previews and tests |
| [3](0003-one-rule-for-day-cleared.md)           | One stored rule for Day Cleared                                        |
| [4](0004-history-is-never-rewritten.md)         | History is never rewritten automatically                               |
| [5](0005-stepwise-versioned-formats.md)         | Separate, stepwise format versions                                     |
| [6](0006-sqlite-and-a-serialized-save-queue.md) | SQLite with a serialized save queue                                    |
| [7](0007-widget-privacy.md)                     | Widgets publish as little as possible                                  |
| [8](0008-no-state-chart-or-schema-library.md)   | No state, chart or schema library                                      |
| [9](0009-dependency-policy.md)                  | Dependency policy                                                      |
| [10](0010-trading-status-table.md)              | One trading status from a priority table                               |
