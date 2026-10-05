# Task board workflow

The product task board lives in `kanban-board/` and uses these columns:

- `ideas`: capture only;
- `backlog`: planned work;
- `work`: active work;
- `test`: needs verification;
- `ready`: approved to ship;
- `prod`: shipped.

When the user asks to continue work, inspect the board source/state first. Pull the highest-priority actionable card from `work`, then `backlog`; keep one card in active work, describe the implementation in the response, and move it to `test` after implementation. Do not silently move cards to `prod`: that requires verification and an explicit release decision.

The current board stores cards in browser `localStorage` under `kanban-cards`; the source schema is `Card { id, title, desc, col, tag, priority }`. If live browser state is unavailable, use the board's source and report that limitation instead of inventing card status.
