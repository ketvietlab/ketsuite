---
title: Sales customers and credit
---

**Sales → Customers** (`/admin/sales/customers`) lists the parties a company sells
to: those holding the customer role, and contacts with no role yet. A party that is
only a supplier is left out, and so is any company's own legal entity. The list is
an island over `sale.listCustomers`; its search covers name, code, phone and email,
and its two filters are the reader's own customers (`mine`) and customers over their
credit limit (`over`).

The contact is the shared `partner.Partner`. What one company decides about the
customer lives in its own row, `sale.CustomerTerms` (salesperson `userId`,
`pricelistId`, `paymentTermId`, `revision`, unique per company and partner). The
credit limit stays on `partner.CompanyTerms.creditLimit`, where accounting reads it.
A salesperson must be an active user with a membership in the company
(`sale.getCustomerChoices` lists them with the company's active pricelists and
payment terms).

Two commands keep the two halves apart, each with the expected revision of the
customer's terms:

- `sale.saveCustomer` (`sale.customer`, operate) writes contact, salesperson and
  pricelist through the shared partner write service, and grants the customer role
  when it is missing. Commerce gives it to the sales representative and the sales
  manager.
- `sale.saveCustomerCredit` (`sale.credit`, configure, configuration audit) writes
  the payment term and the credit limit. An empty limit means no limit; zero is a
  limit. Commerce gives it to the sales manager and the accountant.

Reading customers takes `sale.view` or `sale.credit`, so an accountant opens them
without the Sales order grants. Both commands are idempotent: the customer page
posts them with an idempotency key.

## Credit exposure

`sale.getCustomerCredit` and the customer page add, in the company currency:

- every open item on a receivable account in a posted move for the customer, signed
  by its balance, so a customer payment not yet applied lowers the total;
- for confirmed orders (`sale`, `done`), the tax-included amount of each line not
  yet invoiced (ordered less `qtyInvoiced`);
- with `orderId`, the quotation itself while it is `draft` or `sent`.

Going over the limit is a warning, never a block: the customer page shows it in its
Credit card, and the quotation or order page shows it above its first card
(`creditWarning` in the order page context). Confirming the order is unchanged.
