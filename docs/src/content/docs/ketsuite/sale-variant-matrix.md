---
title: Sales variant quantity matrix
---

Product General information exposes `saleVariantMode`: legacy null and `inline` select on order lines; `matrix` enables quantity entry. Catalogue-edit permission owns the setting. Combos always use inline selection. The native parent save, duplicate projection and product revision include this field; migration adds a nullable column without backfilling legacy products.

The existing order Lines menu lists active selling non-combo templates in the active company with at least two active SKUs and a default unit. Menu metadata is lightweight; the chosen native `sale.variantMatrix` record modal reads its matrix lazily through a permission-checked context route. `sale.saveCatalogueDraft` validates the optional selected template, saves line/delivery drafts atomically and returns that template for navigation. The URL retains company, branch and language and identifies the order with `matrixOrderId`.

One variant-producing attribute renders a quantity list; two render the product editor’s first axis as columns and the second as rows. Attribute order uses sequence then name, as the product editor does. Mobile stacks each row. Three or more axes render the complete variant list. Missing combinations show Unavailable without an input. Non-variant attributes do not create axes or SKUs.

The first ordinary line supplies each SKU’s quantity, unit and discounted unit price; otherwise pricing uses the order pricelist and default unit. Cost data is never included. Save submits only changed cells. An omitted cell stays untouched; blank/zero removes only the first line and only when history permits. Later duplicates are retained. Removal precedes addition so a full order can exchange SKUs. At most 100 cells may be submitted in one batch.

`sale.setVariantMatrix` requires quote-operate permission, a current order revision and matrix fingerprint. A shared product configuration lock protects eligibility while all cell writes run inside one transaction. Any refused cell rolls back earlier line, price, revision and demand writes. Automatic prices requote before history; manual/historical prices remain fixed. Source invoice/delivery quantities and stock references retain the catalogue safeguards. Locked, cancelled and external orders and readers have no writable inputs. Stale configuration requires reopening the matrix; failed submissions retain the local draft.

Read APIs use sale view permission. Native record command failures carry message identifiers separately from literal text so the VI/EN error catalogue translates them. Screen Help documents the actual parent-save, batch, history and recovery behaviour. This feature does not release the PDF renderer, deploy Commerce or migrate a real tenant.
