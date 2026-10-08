# Spec: public API reference package

Design rules live only in [Két Design System](../../skills/ket-design-system/SKILL.md).

- This package is public MIT code published as `@ketvietlab/ketspec`. The product name shown in the UI is **Spec** (`spec.brand`); the package name appears only in code, commands and documentation.
- Depend only on `@ketvietlab/design-system` and `@ketvietlab/ketjs-view` (enforced by `tools/zero-dep-audit.ts`). Compose public design-system components; a missing capability is added to the design system with its specimen and tests, never as local markup or CSS here. `src/styles.css` styles only the document around the root.
- Views (`views.tsx`, `page.ts`) are render-pure and shared by the server and the browser. DOM, history, focus, network calls and secrets belong to `client.ts`.
- Credentials never leave memory: not in the URL, storage, logs or the curl preview.
- User-facing copy uses the `spec.` catalog in `src/messages.ts`, with every key in English and Vietnamese.
- `tools/build-ketspec-client.mjs` bundles `src/browser.ts` into `src/browser/ketspec.mjs` on every build (gitignored).
- Tests: `test/ketspec-*.test.ts` and the browser check `tools/ketspec-browser-e2e.ts`.
