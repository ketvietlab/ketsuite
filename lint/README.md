# KetSuite lint rules

Architecture rules that a regular expression cannot read reliably live here as
[GritQL](https://biomejs.dev/linter/plugins/) plugins for Biome. `biome.json` wires each one to the
paths it governs, so the same rule runs in the editor, in the pre-commit hook and in `npm run lint`.

| Rule | What it keeps | Governs |
| --- | --- | --- |
| `no-raw-jsx-tag` | Markup belongs to the kit: no raw JSX element outside it | `packages/ketsuite/src` and `apps`, except the kit |
| `no-markup-in-html` | No tag or `data-ui` hook in an `html` template outside the kit | same as above |
| `kit-component-as-jsx` | Kit screen components are written as JSX, not called as functions | `.tsx` files there, except the kit |
| `no-shell-internals` | Only `modules/backend/screen.ts` renders the shell joints and navigation header | `packages/ketsuite/src` and `apps` |
| `admin-route-uses-shell` | A file that answers an `/admin` path uses `adminPage()`, not `page()` | same as above |

The rules replace `tools/ui-audit.ts`, which still runs beside them for one release. Unlike the
audit, they read the syntax tree: a `<br>` inside a string or a comment is not markup.

## Exceptions

A file that cannot follow a rule yet says so on its first lines, with the reason:

- `// biome-ignore-all lint/plugin/<rule>: pending kit work — <what the kit needs>` marks a job, not an
  exception. `test/lint-rules.test.ts` fails if the number of such files grows: empty the list, do
  not extend it.
- `// biome-ignore-all lint/plugin/admin-route-uses-shell: not the backend — <why>` marks a page a
  signed-out or shared-device visitor sees, which must not get the admin frame.

Biome reports a suppression that no longer suppresses anything, so a finished job shows up.

## Adding or changing a rule

1. Name the file `lint/rules/<rule>.grit`. Start every message with `[ketsuite/<rule>] ` and say how
   to fix the finding: Biome reports plugin findings under the generic `plugin` category.
2. Wire it into the `overrides` in `biome.json` for the paths it governs.
3. Add the source it must flag and the source it must leave alone to `test/lint-rules.test.ts`.
4. Measure the findings on the whole tree with `npm run lint` before it lands. A new rule that is not
   replacing an existing gate starts with `severity="warn"`.

GritQL details that matter here:

- Write regular-expression groups as `(?:...)`. A capturing group makes the rule fail to run.
- A pattern matches names, not bindings: a local `const document` matches the name `document`. For
  globals use Biome's own scope-aware rules, such as `noRestrictedGlobals`.

```sh
# Run from: /path/to/ketsuite
npm run test:one -- test/lint-rules.test.ts
```
