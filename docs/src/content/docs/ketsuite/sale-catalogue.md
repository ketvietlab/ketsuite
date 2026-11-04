---
title: Sales catalogue
---

The Commerce sales catalogue opens from an existing order's Lines section. `sale.saveCatalogueDraft` atomically saves pending grid and delivery-plan changes before navigation; a refusal keeps the parent draft. `sale.getCatalogue` is a read/view permission and returns only active selling SKUs in the active company, excluding combos and cost data. Filters include descendant categories, accent-insensitive name/code/barcode search and attribute values (OR within one attribute, AND across attributes). URLs retain filters and scope; pages contain up to 24 cards.

`sale.setCatalogueQuantity` requires quote-operate permission and the current order revision. It updates the first ordinary line for a SKU, preserves later duplicates, appends absent SKUs, and removes zero-quantity lines only when no stock/invoice references exist. Writes are atomic and stale revisions are refused. Draft, sent and confirmed unlocked local orders are eligible; external, locked and cancelled orders are read-only.

`priceAutomatic` is nullable: old null rows retain their historical/manual price. New automatic lines and quantity changes requote the order pricelist until stock or invoice history exists. Explicit price or inverse-margin edits select manual pricing. Confirmed demand is resized without detaching delivery references. Delivered and invoiced source quantities protect reductions even before cached counters synchronize.

The native page provides Enter/blur saves, plus/minus, an empty result state, contextual Help, read-only roles and explicit recovery after a failed or uncertain request. Public quantity, parent draft and grid services share transaction boundaries; HTTP handlers do not call other handlers.

Variant quantity entry is documented in [Sales variant quantity matrix](./sale-variant-matrix). Customer signing/payment and PDF renderer deployment remain separate work.
