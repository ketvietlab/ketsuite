import type { KetModule, ModelDef } from '@ketvietlab/ketjs'

const lifecycleWriters = new Set([
  'configureAttributes',
  'saveVariantSetup',
  'generateVariants',
  'importProducts',
  'bulkEditProducts',
])

/** Extensions contribute model names; Product never imports a private extension's implementation. */
export const productReferenceModels = (module: string, models: Record<string, ModelDef>): string[] =>
  Object.entries(models)
    .filter(([, model]) =>
      Object.values(model.fields).some((field) => {
        const type = typeof field === 'string' ? field : field.type
        return type === 'ref:product.Product' || type === 'ref:product.Product?'
      }),
    )
    .map(([name]) => `${module}.${name}`)

/** Declare reference reads at composition time so retirement checks remain auditable. */
export function withProductVariantReferences<T extends KetModule | string>(
  modules: readonly T[],
  extra: readonly string[] = [],
): T[] {
  const references = [
    ...new Set([
      ...extra,
      ...modules.flatMap((module) =>
        typeof module === 'string' ? [] : productReferenceModels(module.name, module.models ?? {}),
      ),
    ]),
  ].sort()
  return modules.map((module) => {
    if (typeof module === 'string' || module.name !== 'product') return module
    const product: KetModule = module
    // Reading a referencing model is a soft integration with its module, so it is declared optional.
    const owners = references.map((model) => model.slice(0, model.indexOf('.')))
    const referenced: KetModule = {
      ...product,
      optional: [...new Set([...(product.optional ?? []), ...owners])].filter((name) => name !== 'product'),
      functions: Object.fromEntries(
        Object.entries(product.functions ?? {}).map(([name, fn]) => [
          name,
          lifecycleWriters.has(name)
            ? {
                ...fn,
                effects: [...new Set([...(fn.effects ?? []), ...references.map((model) => `read:${model}`)])],
              }
            : fn,
        ]),
      ),
    }
    return referenced as T
  })
}
