# KetSuite browser E2E

Playwright tests are grouped by the KetSuite module they exercise. Tests, fixtures,
and generated evidence for a module stay inside the directory with that module's
exact source name.

Run Product tests from this directory with `npm run test:product`, and the
accounting overview with `npm run test:accounting`.

## Product

`product_backend/fixtures/server.mjs` seeds a small cosmetics catalogue into a throwaway SQLite
file and serves the KetSuite deployment over it. It composes the modules as the served workspace
does, permission bundles included, so the people it seeds hold exactly what the server reads: an
administrator, a viewer with the catalogue's view areas, a reader without stock and an outsider
with no part in the catalogue. Every record a spec changes is its own, so the specs run in any
order against one server; a spec that searches must not match another spec's records.

`product_backend/support.ts` holds what the specs share: signing in through the login form,
waiting for the list's read, and `settled` for server-rendered screens, whose islands take over
their markup after the load event (text typed before that is lost). Screenshots go to
`product_backend/artifacts/<spec>/`, which is not committed.

Specs import `test` and `expect` from `support.ts`, not from Playwright: every test then runs under
a guard (`ui`) that fails it for anything a person would see go wrong, whatever the test was about.
That is an uncaught exception, a console error, a request the server refused (4xx/5xx) or that
failed, and, on the last screen, a visible alert, a message key or `E_…` code printed instead of
words, or `undefined`, `NaN`, `Invalid Date`, `[object Object]`. A test that brings a refusal about on
purpose says so with `ui.allow(pattern, why)`; a test that walks several screens reads each with
`ui.check(where)`. A refused request is a defect even when the screen hides it: a screen offers a
person only what they may do (`ctx.allows`, `may.<module>.<function>` in a fill), so nothing it asks
for is turned down.

`sweep.spec.ts` visits every product screen and dialog as the administrator and as the viewer, in
Vietnamese and English, at desktop and phone width, and reads each with the guard and for sideways
scrolling. Each screen states what it shows (the list, a dialog, a refusal), so an address that no
longer opens what it should fails instead of checking nothing. It takes about two minutes of the
suite's two and a half; while working on one screen, `npm run test:product -- --grep-invert @sweep`
runs the rest, and the whole suite runs before the change is handed over.
