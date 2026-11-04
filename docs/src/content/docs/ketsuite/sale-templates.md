# Sales templates in Commerce

Commerce composes `sale_template` (Sales, CRM teams and User) and `sale_template_backend`. Other product deployments do not acquire this optional capability through the shared Sales module.

## Price-free reusable content

Quotation templates contain product quantities/units, sections, notes, optional products, validity days, terms and signature/prepayment preferences. Section templates contain at most 99 product/note rows and at least one product; no combo, free line, nested section, optional product, price, tax, discount or cost is stored. Quotation templates allow at most 100 rows. Saved lines have typed product/unit references so catalogue lifecycle checks can discover their use.

A section copy takes the section name (1–80 normalized characters), belongs to the signed-in saver, and uses their active CRM teams on first save. No teams means shared across the company. A matching name owned by another saver remains a separate template. The saver must confirm overwriting their own matching template and supply its revision; an archived match is restored with the same ID and its team assignments are retained. Quotation names are unique within the company, including archived templates. Template kind and owner cannot change after creation.

## Scope, permissions and transactions

Every read/write is active-company scoped. Ordinary sellers can choose only active shared templates or those assigned to their active CRM membership/leadership teams. `sale_template.configure` grants management; the server rechecks audience, even when a client forges a template ID or requests management reads. `view` reads metadata/configuration; `operate` copies/applies. Creating a quotation through the template function additionally requires `sale.createOrder`.

A company namespace lock serializes template identity, revision, overwrite, lifecycle and application. Copy also holds the source order revision while taking its snapshot. Applying checks and claims the order revision. A supplied template revision is enforced; pickers may omit it to use the current template while the namespace lock is held. Archive/restore has its own revisioned writer and preserves rows, including products retired after the template was saved.

Adding a section appends a header and its rows to an unlocked local draft/sent/confirmed order. Existing rows are unchanged; new product prices use the current order pricelist and quantity/unit. Confirmed orders create the additional stock demand through the existing Sales writer. Refusal rolls back the whole insertion, including revisions and demand. The resulting order cannot exceed 100 rows including headings/notes.

Applying a quotation template is limited to unlocked local draft/sent quotations and requires explicit replacement confirmation when rows already exist. Optional products are retained separately in `sale_template.OrderOption`; they do not become ordinary sale/delivery/invoice rows. The requirements are copied to nullable Sales order extension fields. Creation plus template application shares one caller-owned transaction and replays do not replace a later-edited order.

## Native screens

Settings → Sales templates is a paged collection with company/branch/locale in request and return links. Initial HTML contains the frame/loading state, not records. Controls/results/footer share the paged collection store, including stale-request cancellation, history, retry and retained-result dimming. Metadata responses contain no line arrays. The record uses `RecordPage`, one Save, shared KetGrid and native confirmation for archive; teams and owner are visible, owner is read-only. Changing kind during creation uses `recordStateSelectControl` so quotation-only fields and nested-section actions disappear for section templates.

Sales order pages/modal share the section menu, template pickers and commands. Pending parent drafts block copying/applying templates; dialogs never silently discard them. Overwrite and quotation replacement use the shared confirmation dialog. All wording and screen Help are VI/EN.

## Delivery boundary

These modules do not provide a customer signing portal or payment collection. Signature/prepayment flags are stored preferences; optional products are persisted, not a completed customer selection portal. Native printing composition and the released PDF renderer are separate acceptance work. No tenant migration, release or deployment is implied by local tests.
