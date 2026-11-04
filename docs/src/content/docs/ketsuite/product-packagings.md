---
title: Product packagings
description: Variant eligibility, barcode ownership and the product record grid.
---

Commerce composes `productBackendWith({ combinedInventoryTracking: true,
variantPackagings: true })`. Other deployments retain the default packaging presentation.
The native grid is part of the Product record form and uses the same Save changes command,
revision, refusal handling and dirty guard. It has no second save button or nested form.
The canonical empty KetGrid change-set is registered as its initial draft; merely mounting
it does not change the record. Transport option labels and the barcode-cell lock flag are
removed before submission; the server independently validates the requested scope.

## Domain contract

`product.getPackagingGrid({ templateId })` belongs to `product.view`. It returns the current
revision, rows and unit choices for goods in the active company. Its `editable` flag requires
`product.savePackagingGrid` and an active product. No price or cost is included.

`product.savePackagingGrid({ templateId, expectedRevisionId, changes })` belongs to
`product.stock-setup`. It is a standalone API over the same domain service used by the
optional `packagings` input of `product.saveRecord`. That parent owns the transaction and
checks its own record revision; the service checks the packaging grant even for an internal
call. A malformed, forbidden or conflicting grid rolls back other fields saved with it.
Omitting `packagings` leaves packaging records untouched.

Changes use the native KetGrid `added`, `updated`, `removed` and `order` shape. Each row has
`uomId`, `productId` (`*` means all variants) and `barcode`. There may be at most 20 rows after
an edit. New rows use an active unit from the product's conversion tree, excluding its base
unit, and an active variant belonging to that product. Existing inactive references remain
readable and may be retained unchanged. Multi-level conversions remain supported; there is
no migration to the mock's shallower unit tree.

New rows cannot duplicate a unit for the same variant or overlap an all-variants row. A
barcode identifies one SKU: multi-variant all-variants rows have a locked, empty barcode
cell. A single-SKU product hides the variant choice and may assign its packaging barcode.
GTIN validation and canonical company-wide collision claims are shared with the existing
barcode writers, including inactive and legacy identities. All changing claims/raw barcodes
are released/cleared before a batch assigns replacements, allowing atomic swaps. A failed
claim rolls back the whole transaction.

The grid projects onto existing `TemplateUom` and `ProductUom` relationships. It does not
create a second eligibility store. Both models add nullable `sequence` fields for ordering;
unchanged targets keep their existing IDs. The legacy shared-unit writer now participates
in the Product revision CAS so an older grid cannot erase a concurrent addition. Other
packaging writers already use that revision guard. Existing Sales documents retain their
recorded unit, quantity and price when eligibility is removed; new line choices reflect the
new eligible set.

## Existing shared units and SKU barcodes

An older catalogue can hold one shared TemplateUom and per-SKU ProductUom barcode records
for that same unit. Those records are valid existing data and are not silently expanded,
recoded or removed. For one SKU the reader combines the shared unit and its barcode into
one visible row. For multiple SKUs it keeps both scopes visible and shows an explanatory
notice. Existing overlapping pairs may remain while their targets stay unchanged; an edit
cannot introduce a new overlapping pair. Removing a row explicitly removes its relationship
and associated barcode. Clearing a single-SKU shared row's barcode keeps its shared unit.

An untouched grid is omitted from the main save, so other Product edits do not normalize
legacy records. The server never accepts client-supplied company IDs or arbitrary record IDs.
Missing/foreign row IDs and stale revisions are refused. The screen keeps failed drafts for
correction; its VI/EN Help explains the scope and removal behavior.
