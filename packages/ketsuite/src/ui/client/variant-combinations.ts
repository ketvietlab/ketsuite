/** Bound automatic previews before allocating their Cartesian product. Manual rows remain available. */
export const variantCombinationPreview = (
  groups: readonly { attributeId: string; values: readonly { valueId: string }[] }[],
  limit = 256,
) => {
  const count = groups.length
    ? groups.reduce((total, group) => Math.min(limit + 1, total * group.values.length), 1)
    : 0
  if (count > limit) return { overflow: true, combinations: [] as Record<string, string>[] }
  const combinations = groups.length
    ? groups.reduce<Record<string, string>[]>(
        (rows, group) =>
          rows.flatMap((row) =>
            group.values.map((value) => ({ ...row, [group.attributeId]: value.valueId })),
          ),
        [{}],
      )
    : []
  return { overflow: false, combinations }
}
