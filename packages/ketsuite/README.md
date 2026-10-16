# KetSuite

Native record dialogs default to confirming changed drafts before closing.
`RecordModalDialog.discardPolicy: 'allow'` opts a non-persistent preview out of that
confirmation. It applies only to that dialog; parent record drafts and ordinary
editing/planning dialogs retain their existing guard. `RecordModalForm.dirty`
keeps its structural-edit meaning and is not a close-policy switch.

Composable business modules and UI built on the public KetJS contracts. KetSuite includes backend,
website, commerce, collaboration, accounting, inventory, CRM, and hospitality modules.

> KetSuite 0.x is preview software. Business contracts and migrations may change before 1.0.

Native record commands may declare `clearRecordDrafts` to consume only named
fields after all command steps succeed. Inline commands preserve other header
or section drafts; child dialogs consume the declared parent fields. Omitting
the option retains the existing full record-draft reset for record submissions.
Failed commands preserve drafts.

Record contexts provide the optional, compatible `draftCheckedValues(name)` API
to read captured checkbox/radio selections in the current record or child-dialog
layer, including choices on unmounted pages. It returns a fresh readonly array;
`draftChecked(name, value, fallback)` keeps its existing behavior. Paged selectors
may submit hidden inputs for captured selections outside the visible page, once
per value. `RecordStateTrigger.resetFields` and command `clearRecordDrafts` clear
every checkbox value of each named field, preserving similarly named fields and
drafts in other layers. This does not select unseen rows or bypass server validation.

Record sheets defer Escape and Tab to an open native dialog, including the
screen HelpDrawer, and ignore already handled keyboard events. Closing Help
returns focus to its trigger and preserves the record draft; it must not also
open the record's discard confirmation.

VariantEditor bounds automatic combination previews and bulk generation to 256
combinations before allocation. Larger selections show a translated warning and
retain manual row creation. Potential combinations are not saved SKU records;
rows become records only after explicit generation/selection and a successful save.

Informational `no_variant` attributes do not define additional SKUs. When they
are the only selected attributes and the editor has no variant rows, the empty
state explains that the product retains its own SKU. Hosts may supply
`noExtraVariants` and `noExtraVariantsHint` labels; older label sets fall back to
the existing empty-state and informational copy. The Commerce mock projection
must not remove the base SKU merely because descriptive lines were saved.

Native record submission belongs to its closest `ket-island` host. The record
runtime defers forms owned by nested islands, so an inline editor's submit cannot
also run a parent command or replace the record URL/context.

```bash
npx -y @ketvietlab/ketsuite@latest new my_suite
cd my_suite
npm install
npm run dev
```

Open `http://127.0.0.1:3000/admin/login` and sign in with `admin` / `admin`. That account is created
only by the generated development script against an empty local database. It is intentionally
insecure; `npm start` does not create it.

To consume selected modules instead of the complete application:

```bash
npm install @ketvietlab/ketsuite @ketvietlab/ketjs
```

```ts
import { product, sale, stock } from '@ketvietlab/ketsuite'
```

KetSuite is intentionally a normal third-party consumer of `@ketvietlab/ketjs`; repository audits prevent it
from importing framework internals.

See the [KetSuite quick start](https://github.com/ketvietlab/ketjs/blob/develop/docs/src/content/docs/ketsuite/quick-start.md)
for configuration and secure administrator provisioning.
