---
title: Product catalogue search
description: Permission-aware search across the active company catalogue.
---

The Products topbar opens a hidden Search in Products collection. It combines products,
variants/SKUs, attributes, units, categories, tags, combo choices and import receipts,
with 25 results per page and Name / Document number, Code and Type columns.

The search reuses collection readers. Product and SKU matching includes packaging
barcodes; receipt matching includes imported product codes. Attribute values and tag
names are searchable. Blank queries return no results. Archived catalogue records are
excluded, including SKUs whose parent is archived. Import receipts remain historical.
Status, category, tag, use, sorting and selection carried from another list do not narrow
this search. Company, branch and locale context remain in native links.

The `product_backend.searchCatalogue` read requires catalogue view permission. Each
provider also requires its collection read and target record permission; unavailable
providers contribute neither rows nor counts. Responses contain only identity, name,
code, type and navigation fields, never product costs or imported source data.

Products and SKUs open the real parent product page. Back to list returns to the search
query and page. Configuration and receipt results open their native record modal over
the corresponding collection. Closing that modal stays on its collection. Browser Back
returns to the prior search. VI/EN screen Help describes this behavior.

This is one production catalogue per active company. It does not create the mock's
separate bookkeeping store or map production IDs to mock records.

Legacy native `record=product.template:<id>` links redirect to that same product page,
carrying company/branch/locale hints, tab and a cleaned collection return URL. The active
authorized session remains the source of company scope; URL hints do not switch identity.
Return destinations are limited to local Product, SKU and search collections. Malformed,
external or record-page destinations fall back to the scoped Product collection; nested
return targets and modal parameters are removed. Native create/import/favorite routes
remain real catalogue workflows. Atlas-only paths and its two-store migration are not
production routes.

Mounting the supplier grid does not mark the product dirty. Unsaved edits still require
confirmation before leaving; restoring the original fields clears that guard.
