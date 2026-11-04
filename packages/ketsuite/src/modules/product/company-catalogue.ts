import type { KetModule } from '@ketvietlab/ketjs'
import { withProductVariantReferences } from './variant-references.ts'

/** Shared catalogue records that acquire a company during the catalogue migration. */
export const companyCatalogueModels = [
  'uom.Unit',
  'product.Brand',
  'product.Category',
  'product.Tag',
  'product.TemplateTag',
  'product.Combo',
  'product.ComboItem',
  'product.TemplateCombo',
  'product.Template',
  'product.TemplateStateEvent',
  'product.Product',
  'product.TemplateUom',
  'product.Attribute',
  'product.AttributeValue',
  'product.TemplateAttributeLine',
  'product.TemplateAttributeValue',
  'product.ProductValue',
  'loyalty.ProductTag',
] as const

/** Indexes that hold per company once the catalogue is split: copies keep their barcodes. */
const perCompanyIndexes: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  'product.Combo': { combo_name_key_unique: ['nameKey', 'companyId'] },
  'product.ComboItem': { combo_product_unique: ['comboId', 'productId', 'companyId'] },
  'product.TemplateCombo': { template_combo_unique: ['templateId', 'comboId', 'companyId'] },
  'product.Tag': { tag_name_key_unique: ['nameKey', 'companyId'] },
  'product.TemplateTag': { template_tag_unique: ['templateId', 'tagId', 'companyId'] },
  'product.Category': { category_name_key_unique: ['nameKey', 'companyId'] },
  // Keep the existing company lookup index when adding uniqueness to legacy catalogues.
  'product.Attribute': { name_key: ['nameKey', 'companyId'] },
  'product.Product': {
    barcode_unique: ['companyId', 'barcode'],
    code_key_unique: ['companyId', 'codeKey'],
  },
}

const rescope = <T extends KetModule | string>(modules: readonly T[], scope: 'company' | 'shared'): T[] =>
  modules.map((entry) => {
    // A module named by string is a deployment's own and owns no catalogue model.
    if (typeof entry === 'string') return entry
    const module: KetModule = entry
    const owned = Object.keys(module.models ?? {}).filter((name) =>
      (companyCatalogueModels as readonly string[]).includes(`${module.name}.${name}`),
    )
    if (!owned.length) return entry
    const models = { ...module.models }
    for (const name of owned) {
      const key = `${module.name}.${name}`
      const model = models[name]!
      const indexes = { ...model.indexes }
      for (const [index, fields] of Object.entries(perCompanyIndexes[key] ?? {})) {
        const held = indexes[index]
        if (!held) throw new Error(`Missing catalogue index: ${key}.${index}`)
        indexes[index] = {
          ...held,
          fields: scope === 'company' ? [...fields] : fields.filter((field) => field !== 'companyId'),
        }
      }
      models[name] = { ...model, scope, indexes }
    }
    return { ...module, models } as T
  })

/**
 * A deployment that keeps its catalogue per company composes its modules through this:
 * every catalogue model in company scope, and the product barcode unique per company.
 * Other deployments keep the shared catalogue the modules declare.
 */
export const companyCatalogueModules = <T extends KetModule | string>(
  modules: readonly T[],
  productReferences: readonly string[] = [],
): T[] => withProductVariantReferences(rescope(modules, 'company'), productReferences)

/** The same modules with the shared catalogue: the schema a database has before its split. */
export const sharedCatalogueModules = <T extends KetModule | string>(modules: readonly T[]): T[] =>
  rescope(modules, 'shared')
