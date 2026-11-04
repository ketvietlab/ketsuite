---
title: Sales sections and optional quantities
description: Structural quotation rows and revisioned optional-section selection.
---

Sales OrderLine has nullable `displayType` and `optionalSection`. Legacy null rows
remain commercial. `section` and `note` require a trimmed 1–500 character description,
no product/unit/tax identities and zero monetary fields. They do not create cost,
fulfilment or invoice facts. A quotation containing only structural rows cannot confirm.
Existing databases use the normal additive migration plan; no request performs a migration.

The native quotation grid offers Add line, Add section and Add note. Sections contain
following rows up to the next section; notes do not end a section. Save all grid drafts
before the Optional sections dialog. Its checkboxes refer to saved section IDs.
`setOptionalSections` requires the same edit grant as the grid, an unlocked locally
owned quotation, company scope and an expected order revision. Unknown/non-section
IDs, duplicate IDs and historical stock/invoice references are refused atomically.

Newly checked sections reset contained commercial quantities to zero, including
combo children through their parent. Saving the same checked set is a no-op; unchecking
preserves quantities. Sellers may then enter chosen quantities. The ordinary grid
cannot forge optional flags or change a saved row's kind. Reordering preserves flags
without implicitly resetting quantities. KetGrid `fullWidthTag` displays the translated
Optional suffix separately from the editable description; confirmed tables show it too.

Sales quantities may be zero, but never negative. Sales uses the shared tax calculation
with an explicit internal zero-quantity option; public account quotes and invoice
posting keep the default positive-quantity requirement. Zero rows retain prices and
tax selection while contributing zero amounts. Confirmation retains them without
creating stock demand; invoice creation skips them. Require a product applies to free
commercial lines, including zero rows, but does not apply to sections and notes.

This contract covers the seller's native record and backend. Customer selection during
signing/payment and document-preview parity are separate unfinished acceptance work.
No customer signing/payment capability is implied by the optional flag.

Customer-facing quotation, sales-order and pro-forma templates sort by sequence/ID.
They compose section/note text across the content width and group commercial rows
into six-column tables. The Optional suffix is translated at render time and never
changes the saved name. A single repeatable table header avoids accumulating one
header per section on each PDF page; zero commercial quantities remain visible.
The public renderer supports this composition without a merged-cell extension.
Report-source contracts retain `lines` and add `blocks`; costs remain excluded.
This template contract does not enable a renderer route in deployments that have
not composed the report module, and does not add customer signing/payment.
