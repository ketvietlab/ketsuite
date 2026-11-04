---
title: Sales order pricelists
description: Default pricelist and payment term of a new quotation, and Update prices.
---

A new quotation (`sale.createOrder`, quotation templates, saving a draft from the page, CRM quotations) that does not name a pricelist takes the customer's pricelist from `sale.CustomerTerms`; a customer without one gets the company's first active pricelist by sequence, then id. The payment term follows the customer's terms the same way. A caller that names a value keeps it, including an explicit `null` for no pricelist or no term. The storefront passes its own pricelist (or none) and no term, so a web order keeps the prices its cart showed.

`sale.updatePrices` (bundle `sale.quote-operate`) reprices a draft or sent, locally owned, unlocked quotation at its current revision. It may switch the pricelist first; the new one must be active and in the order's currency. Every product line with no stock move, no invoice line and nothing delivered or invoiced is priced again by that pricelist as if just added: a manual price and discount on such a line give way. Rewards, discounts, combo items and lines with history keep their prices. A quotation that already has stock or invoice history (a cancelled order set back to draft) edits its lines one by one, as a confirmed order does, with the computed price and discount. With nothing to reprice, the pricelist change still moves the order to a new revision. Any refusal rolls back the pricelist change. A confirmed order keeps the pricelist it was sold under.

The quotation page shows **Update prices** beside the products table when the viewer may run it; the dialog picks the pricelist (pre-filled with the current one) and posts with the order revision and an idempotency key. VI/EN screen Help documents the defaults and the action.

Changing a quantity keeps a negotiated price; only automatic prices follow the pricelist's quantity breaks.
