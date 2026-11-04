---
title: Product imports
description: Atomic pasted product imports, immutable receipts, permissions and reversible CSV exports in Commerce.
---

# Product imports

Commerce product keepers open **Import** on Products, or **Product imports** in configuration.
The native record modal accepts pasted CSV or tab-separated spreadsheet cells. There is no upload,
preview job or background queue. A request has at most 500 nonblank rows and 256 KiB of UTF-8 source.
One refused row rolls back the entire request, including receipt numbering. The form keeps the exact
source and reports its row and column. A successful request opens its immutable `NHAP/0001` receipt.

## Columns and matching

Headers accept Vietnamese and English, with or without accents, in any order. Unknown headers are
ignored; repeated headers and aliases are refused. Product code is required. Codes group rows without
case distinctions. The first nonblank product name, category, VAT and sales price wins in each group.
Type and unit apply only to a new product; existing products keep both. Goods is the default type.
Units and taxes resolve by name or code, and categories by their full path or an unambiguous leaf.
All lookups resolve within the active company, including for users who can read several companies.

Attribute values use `Colour:Red;Size:S`. Both attributes and values must already exist. A backslash
quotes a colon, semicolon or backslash inside a name. New values extend the product's native attribute
configuration and its combinations. Descriptive attributes keep the same SKU. Variant code, barcode,
own sales price and cost apply to the exact combination. A product-only row does not need attributes.
Blank cells retain existing values. Combos and inventory quantities are outside this command.

Both `159.000` and `159,000` mean 159000. Money is parsed as decimal text, without floating-point
rounding. Exported three-digit fractions include a trailing zero to prevent thousands interpretation.
Spreadsheet formula prefixes are escaped reversibly; literal apostrophes and quoted multiline cells
round-trip. Original product grouping codes remain stable when an import changes a variant code.

## Transaction and permissions

`product.importProducts` belongs to `product.configure`: Commerce company administrators and sales
managers may import. The command uses the same domain writers as `product.saveRecord`,
`product.configureAttributes`, `product.saveVariantSetup` and `product.setCost`. Their extracted services
accept an explicit `inTransaction` option where necessary; the importing caller owns rollback. Changed
stock and accounting fields retain their existing per-field grants and physical-stock guards.

`product.saveRecord.taxId` assigns an existing sales tax under the general product-edit grant. It reuses
the accounting tax-assignment validator and does not grant tax creation or accounting administration.
Tax, barcode, cost and attribute changes invalidate an open product revision. Unchanged products/SKUs
are not saved or counted; their revisions and timestamps remain unchanged. Even a no-op request creates
an audit receipt. Same-ID/same-source retries return the existing receipt; different source under that ID
is refused. Competing imports serialize through a company sequence; a conflict can be retried safely.

`product.Import` and `product.ImportItem` are append-only. Receipt items retain product identity and name
snapshots after an otherwise permitted product deletion. The product page links its latest 20 imports
and the complete filtered history. All catalogue readers may read receipts. List projections omit source
text. Receipt details redact the cost column unless the reader holds `product.listVariantCosts`.

## CSV downloads

The new-import link downloads every active SKU except combos using import-compatible localized columns.
Cost is omitted without cost-read permission. Reimporting an unchanged download is a no-op for the products.
Descriptive attributes already on a product are retained. Large downloads must be pasted in batches within
the import limits. Legacy products without a stable grouping code or complete identifying attribute values
must be corrected before an import-compatible export can be generated; no code or combination is invented.

**Export CSV** on Products and Variants uses the filtered collection and the columns of that list,
including only authorized stock/margin/cost columns. It reads all result pages rather than only the first
page. Grouping is flattened while filters and sort are retained. Filenames use `product-`: `product-list.csv`,
`product-variants.csv`, and `product-import.csv`. These collection CSVs are for viewing; only the import
sheet promises import-compatible columns. All downloads guard spreadsheet formulas and use no-store responses.

## Verification boundary

The implementation is verified against the Commerce composition using focused SQLite and PostgreSQL HTTP
tests, parser and native render tests, descriptor snapshots and browser evidence. This does not imply a
repository-wide test pass, deployment, data migration or framework release. The focused sources are
`test/product-import-format.test.ts`, `test/product-imports-http.test.ts` and `test/product-imports-ui.test.tsx`.
