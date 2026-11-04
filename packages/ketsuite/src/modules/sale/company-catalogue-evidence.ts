/**
 * Order line evidence a copied company keeps byte for byte when the catalogue splits.
 * Both fields describe taxes (`account.Tax` IDs and their quoted amounts), never a
 * product, and a refund only rescales the stored amounts.
 */
export const saleCatalogueEvidence = {
  'sale.OrderLine': ['taxEvidence', 'taxIds'],
} as const satisfies Readonly<Record<string, readonly string[]>>
