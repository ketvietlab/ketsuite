# Flow UI: public component package

Design rules live only in [Két Design System](../../skills/ket-design-system/SKILL.md),
including its [Flow compatibility reference](../../skills/ket-design-system/references/flow.md).

User decision, 2026-10-08: Flow owns its UI kit and inherits Két's design DNA.
Changes inside flow-ui are not limited to maintaining its current geometry or
matching Suite page/form patterns. Evolve components, layout and interactions
for Flow, with an explicit contract and measured verification. Keep shared
semantic colour, font/icon identity and accessibility; consumers compose the
public API rather than restyling private descendants. This decision supersedes
older guidance that requires every duplicated Flow primitive to move into Suite DS.

- This package is public MIT code published as `@ketvietlab/flow-ui`. It holds presentation only: no product data, persistence, routing, API calls, identity-provider integration or paid-feature components. Those stay in the consuming product.
- Depend only on `@ketvietlab/design-system`, `@ketvietlab/ketjs`, `@ketvietlab/ketjs-view` and `@ketvietlab/ketsuite/livedoc` (enforced by `tools/zero-dep-audit.ts`). Never import Suite page shells, list pages or record-modal internals.
- Source stays JavaScript (`.mjs`) with JSDoc types; `npm run build` type-checks it and emits `.d.mts`. This is a documented exception to the repository TypeScript default, recorded in the root `AGENTS.md`.
- Keep server rendering pure. Native dialog behavior belongs in the explicit, disposable runtime. Business data, persistence and navigation belong to consumers, never the kit.
- Update the demo and focused semantic/behavior tests with components. Demo fixtures are not production functionality.


- User-facing copy uses the `flow.` i18n catalog in `src/messages.mjs` with English, Japanese and Vietnamese entries. Products add keys through `registerFlowMessages`, never by editing this catalog.
