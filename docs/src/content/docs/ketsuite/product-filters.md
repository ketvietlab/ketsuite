---
title: Product and SKU filters
description: Catalogue use filters and company-scoped private or shared saved searches.
---

Products and SKUs offer **Can be sold**, **Can be purchased**, **Not sold** and **Tracked by lot**.
SKUs inherit these flags from their parent product. Legacy unset sale/purchase flags mean enabled.
Lot tracking requires explicit inventory tracking and the lot policy; services are excluded.
Product filters retain native grouping, custom conditions and the existing default-filter feature.

## Saved filters

The **Saved** menu lists your filters and filters shared in the current company. Applying one
restores search, status, category, tags, use and sorting. Product searches also retain native
custom conditions and grouping. Paging, expanded groups, selected rows and modal parameters are
never persisted. Product and SKU lists use distinct keys, `product.templates` and `product.variants`.

**Save current filter** opens the native record modal. Names are trimmed, at most 60 characters,
and unique without case distinctions among one owner's filters in the same list. Sharing is
optional and limited to the active company. All catalogue readers can save filters; this does not
grant permission to edit products. A matching filter is named in the menu. When it belongs to you,
**Edit saved filter** changes its name or sharing, or deletes it after confirmation. Other people's
shared filters are read-only. Deleted filter names can be reused.

## Storage and compatibility

The existing `backend.SavedSearch` model remains the only store. Nullable company, sharing,
normalized-name and revision fields preserve old private rows. A legacy row without a company
marker remains visible only to its owner; the next save binds it to the active company. No bulk
backfill or real-tenant migration is performed by this change.

All catalogue writes, including old favorite entry points, use the same owner and company guards.
Native edit/delete commands require the revision read by the modal. Compare-and-set rejects a
concurrent update; a transactional refusal rolls back prior default changes. The normalized-name
unique index arbitrates concurrent inserts on SQLite and PostgreSQL. Native commands declare
idempotency so retrying one submission returns its recorded result.

The modal keeps raw rejected input and field-level errors. Delete is a separate command, so it
requires neither a name nor the edit form. Close and reopen after a revision conflict. VI/EN Help
uses the standard drawer, and small-screen record modals use the design-system fullscreen contract.

## Verification boundary

Focused Commerce HTTP and render tests cover use flags, URL/state round trips, exact list and
company isolation, reader permissions, owner-only edits, duplicate names, stale revisions,
concurrent writes, deletion/name reuse and legacy entry points. Producer descriptor snapshots
and consumer permission inventories describe the same functions. These local checks do not
imply a release, deployment or cross-deployment regression pass.
