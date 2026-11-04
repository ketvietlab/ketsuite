---
title: Sales warnings
---

Sales warnings are company settings, defaulting to off. `sale.saveConfiguration`
keeps its expected revision; older callers omitting `saleWarnings` preserve the
stored setting. Turning it off hides notes without deleting their content.

The shared contact directory does not own company sales notes.
`sale.PartnerWarning` stores one message/revision per company and partner.
`savePartnerWarning` trims at most 300 characters, requires the expected revision,
serializes with company Sales configuration, refuses writes while disabled and
leaves no-op revisions unchanged. An empty message clears the note. Customer
editing has its own `sale.customer-warning` capability; the Commerce company
administrator, sales representative and sales manager receive it. Readers use
`sale.view` or the editing capability. `getWarningSettings` exposes only the
boolean; catalogue administrators need no order-read grant to open their field.

`product.Template.saleWarning` is nullable catalogue metadata, shared by its
variants. Commerce scopes the template to its company. Its native page validates
300 characters, includes it in the general field group and saves under the existing
product revision. Duplication copies it. Missing/disabled warning configuration
omits the field and its command key; saving unrelated fields must not erase it.

`getOrder.saleWarnings` and `previewWarnings` read customer first, then unique
product templates in selection order, including ordinary gift lines. There is no
blocking validation on quotation confirmation. Cancelled orders have no notices.
Preview accepts identifiers only; warning text and company scope come from the
server. It is a live advisory, not a historical snapshot on an invoice or delivery.

Native Sale uses a read-only record panel for notices. Draft customer selection
and KetGrid changes update the identifier selection before saving. Structural
rows and removed lines do not contribute products. Parent `observeDrafts: ['lines']`
reconciles the hidden native grid value; the runtime retains a grid reflecting its
own carry so focus and undo remain owned by KetGrid. See the record-modal contract.

Sales record notices, facts, benefits, lines, configuration forms and customer
profile blocks each own a working Surface. Only the page header sits directly on
canvas. Shared RelationSelect restores focus to its replacement trigger when
native draft reconciliation replaces the field's island.

The partner profile is a RecordPage with a separate native panel for the current
company's note. Its joint uses `jointFor` and `may`, and its context/read/write
check permissions independently. VI/EN Help describes separate contact, company
note and product edits. This integration does not claim the full Sales customer
profile or portal acceptance is complete.

Existing installations need an operator-reviewed additive migration: nullable
`product.Template.saleWarning`, nullable `sale.Configuration.saleWarnings`, and
the company-scoped `sale.PartnerWarning` table/index. Legacy null means off/empty.
The focused tests exercise migration on disposable SQLite/PostgreSQL fixtures;
no request applies tenant migrations automatically.
