/**
 * Order line evidence a copied company keeps byte for byte when the catalogue splits.
 * Tax fields describe taxes only. Lot selections name lots, which are not copied, and
 * their stock revision is checked against live availability, which asks for a reload
 * when the position no longer matches.
 */
export const posCatalogueEvidence = {
  'pos.OrderLine': ['lotSelections', 'taxEvidence', 'taxIds'],
} as const satisfies Readonly<Record<string, readonly string[]>>
