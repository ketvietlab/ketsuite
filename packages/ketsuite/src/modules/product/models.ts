import type { ModelDef } from '@ketvietlab/ketjs'

/**
 * Master data, declared shared: one catalogue across every company in the tenant.
 * A deployment that keeps it per company (Commerce) composes these models through
 * `companyCatalogueModules` in company-catalogue.ts instead.
 *
 * The template/variant split follows the domain contract, including the name `Product` for the
 * variant. It reads oddly — a "product" here is one sellable combination, not the
 * thing a customer would call a product — but keeping the name makes the migration
 * map one to one, and a comment costs less than a translation table.
 */
export const models: Record<string, ModelDef> = {
  BulkEdit: {
    scope: 'company',
    append: true,
    fields: {
      id: 'id',
      name: 'text',
      actor: 'text',
      occurredAt: 'datetime',
      field: 'text',
      value: 'text',
      valueLabel: 'text?',
      request: 'json',
      productCount: 'int',
      changedCount: 'int',
    },
    indexes: { bulk_name: { fields: ['companyId', 'name'], unique: true } },
  },
  BulkEditItem: {
    scope: 'company',
    append: true,
    fields: {
      id: 'id',
      bulkEditId: 'ref:product.BulkEdit',
      templateId: 'text',
      code: 'text',
      name: 'text',
      before: 'json',
      after: 'json',
    },
    indexes: { bulk_product: { fields: ['templateId', 'bulkEditId'] } },
  },
  BulkEditSequence: { scope: 'company', fields: { id: 'id', value: 'int', revision: 'text' } },
  Import: {
    scope: 'company',
    append: true,
    fields: {
      id: 'id',
      name: 'text',
      actor: 'text',
      occurredAt: 'datetime',
      data: 'text',
      rowCount: 'int',
      createdCount: 'int',
      changedCount: 'int',
      variantCount: 'int',
    },
    indexes: {
      import_name: { fields: ['companyId', 'name'], unique: true },
      import_time: { fields: ['occurredAt'] },
    },
  },
  ImportItem: {
    scope: 'company',
    append: true,
    fields: {
      id: 'id',
      importId: 'ref:product.Import',
      // Audit identity survives an otherwise deletable product; the reader resolves a live link.
      templateId: 'text',
      code: 'text',
      name: 'text',
      created: 'bool',
      changed: 'bool',
      variantIds: 'json',
    },
    indexes: { imported_product: { fields: ['templateId', 'importId'] } },
  },
  ImportSequence: {
    scope: 'company',
    fields: { id: 'id', value: 'int', revision: 'text' },
  },
  Brand: {
    scope: 'shared',
    fields: {
      id: 'id',
      name: 'text',
      active: 'bool',
    },
    indexes: { name: { fields: ['name'] } },
  },

  Category: {
    scope: 'shared',
    fields: {
      id: 'id',
      name: 'text',
      // Optional because the root has no parent, and a required self-reference
      // could never be satisfied by the first row.
      parentId: 'ref:product.Category?',
      // Null legacy rows remain active and claim their name on the next edit.
      active: 'bool?',
      nameKey: 'text?',
    },
    indexes: { category_name_key_unique: { fields: ['nameKey'], unique: true } },
  },

  Tag: {
    scope: 'shared',
    fields: { id: 'id', name: 'text', nameKey: 'text', active: 'bool', revisionId: 'text' },
    indexes: { tag_name_key_unique: { fields: ['nameKey'], unique: true } },
  },

  TemplateTag: {
    scope: 'shared',
    fields: { id: 'id', templateId: 'ref:product.Template', tagId: 'ref:product.Tag', sequence: 'int' },
    indexes: { template_tag_unique: { fields: ['templateId', 'tagId'], unique: true } },
  },

  Combo: {
    scope: 'shared',
    fields: { id: 'id', name: 'text', nameKey: 'text', active: 'bool', revisionId: 'text' },
    indexes: { combo_name_key_unique: { fields: ['nameKey'], unique: true } },
  },

  ComboItem: {
    scope: 'shared',
    fields: {
      id: 'id',
      comboId: 'ref:product.Combo',
      productId: 'ref:product.Product',
      extraPrice: 'decimal',
      sequence: 'int',
    },
    indexes: { combo_product_unique: { fields: ['comboId', 'productId'], unique: true } },
  },

  TemplateCombo: {
    scope: 'shared',
    fields: { id: 'id', templateId: 'ref:product.Template', comboId: 'ref:product.Combo', sequence: 'int' },
    indexes: { template_combo_unique: { fields: ['templateId', 'comboId'], unique: true } },
  },

  TemplateStateEvent: {
    scope: 'shared',
    append: true,
    fields: {
      id: 'id',
      templateId: 'ref:product.Template',
      active: 'bool',
      reason: 'text?',
      actor: 'text?',
      occurredAt: 'datetime',
      revisionId: 'text',
      activeProductIds: 'json',
    },
    indexes: { template_time: { fields: ['templateId', 'occurredAt'] } },
  },

  Template: {
    scope: 'shared',
    timestamps: true,
    fields: {
      id: 'id',
      name: 'text',
      // 'goods' | 'service' — see types.ts. Validated on the way in rather than by
      // the column, because the type vocabulary is deliberately small.
      type: 'text',
      categoryId: 'ref:product.Category?',
      brandId: 'ref:product.Brand?',
      uomId: 'ref:uom.Unit?',
      origin: 'text?',
      description: 'text?',
      summaryDoc: 'text?',
      descriptionDoc: 'text?',
      revisionId: 'text?',
      listPrice: 'decimal',
      // Stable prefix for automatically assigned variant codes after the first configuration.
      variantCodeBase: 'text?',
      // The struck-through price during a discount; above `listPrice` when set.
      compareAtPrice: 'decimal?',
      // Harmonized System code for customs, 4 to 10 digits.
      hsCode: 'text?',
      saleOk: 'bool',
      saleVariantMode: 'text?',
      purchaseOk: 'bool',
      saleDelay: 'int?',
      saleWarning: 'text?',
      active: 'bool',
    },
    indexes: { name: { fields: ['name'] } },
  },

  /** One sellable combination of a template. the domain contract calls this product.product. */
  Product: {
    scope: 'shared',
    timestamps: true,
    fields: {
      id: 'id',
      templateId: 'ref:product.Template',
      defaultCode: 'text?',
      // Legacy rows keep this null until their code changes; see product/codes.ts.
      codeKey: 'text?',
      barcode: 'text?',
      weight: 'decimal',
      volume: 'decimal',
      // Null sells at the template price plus the extras of the variant's values (P3/P28).
      listPriceOverride: 'decimal?',
      // Null falls back to the template's HS code.
      hsCode: 'text?',
      combinationKey: 'text',
      active: 'bool',
    },
    indexes: {
      template_combination: { fields: ['templateId', 'combinationKey'], unique: true },
      barcode_unique: { fields: ['barcode'], unique: true },
      default_code: { fields: ['defaultCode'] },
      code_key_unique: { fields: ['codeKey'], unique: true },
    },
  },

  Cost: {
    scope: 'company',
    fields: { id: 'id', productId: 'ref:product.Product', standardPrice: 'decimal' },
    indexes: { product_company: { fields: ['companyId', 'productId'], unique: true } },
  },

  TemplateUom: {
    scope: 'shared',
    fields: { id: 'id', templateId: 'ref:product.Template', uomId: 'ref:uom.Unit', sequence: 'int?' },
    indexes: { template_uom: { fields: ['templateId', 'uomId'], unique: true } },
  },

  /** Cross-SKU/packaging uniqueness for new barcode assignments; legacy rows stay untouched. */
  BarcodeClaim: {
    scope: 'company',
    fields: { id: 'id', code: 'text', ownerKind: 'text', ownerId: 'text' },
    indexes: {
      barcode_claim_code: { fields: ['companyId', 'code'], unique: true },
      barcode_claim_owner: { fields: ['companyId', 'ownerKind', 'ownerId'], unique: true },
    },
  },
  ProductUom: {
    scope: 'company',
    fields: {
      id: 'id',
      productId: 'ref:product.Product',
      uomId: 'ref:uom.Unit',
      barcode: 'text?',
      sequence: 'int?',
    },
    indexes: {
      product_uom: { fields: ['companyId', 'productId', 'uomId'], unique: true },
      barcode_company: { fields: ['companyId', 'barcode'], unique: true },
    },
  },

  Attribute: {
    scope: 'shared',
    fields: {
      id: 'id',
      name: 'text',
      nameKey: 'text?',
      sequence: 'int',
      displayType: 'text',
      createVariant: 'text',
      active: 'bool',
    },
    indexes: { name: { fields: ['name'] }, name_key: { fields: ['nameKey'], unique: true } },
  },

  AttributeValue: {
    scope: 'shared',
    fields: {
      id: 'id',
      attributeId: 'ref:product.Attribute',
      name: 'text',
      sequence: 'int',
      htmlColor: 'text?',
      defaultPriceExtra: 'decimal?',
    },
    indexes: {
      attribute_name: { fields: ['attributeId', 'name'] },
      name: { fields: ['name'] },
    },
  },

  TemplateAttributeLine: {
    scope: 'shared',
    fields: { id: 'id', templateId: 'ref:product.Template', attributeId: 'ref:product.Attribute' },
    indexes: { template_attribute: { fields: ['templateId', 'attributeId'], unique: true } },
  },

  TemplateAttributeValue: {
    scope: 'shared',
    fields: {
      id: 'id',
      lineId: 'ref:product.TemplateAttributeLine',
      valueId: 'ref:product.AttributeValue',
      // Added to the template's list price when a variant carries this value.
      priceExtra: 'decimal?',
    },
    indexes: {
      line_value: { fields: ['lineId', 'valueId'], unique: true },
      value: { fields: ['valueId'] },
    },
  },

  /**
   * The join between a variant and the values that define it. An explicit model
   * rather than a hidden many-to-many: the framework has no magic for it, and a
   * join you can see is a join you can query, scope and migrate.
   */
  ProductValue: {
    scope: 'shared',
    fields: {
      id: 'id',
      productId: 'ref:product.Product',
      templateAttributeValueId: 'ref:product.TemplateAttributeValue',
    },
    indexes: {
      product_value: { fields: ['productId', 'templateAttributeValueId'], unique: true },
      template_attribute_value: { fields: ['templateAttributeValueId'] },
    },
  },

  /**
   * Where a catalogue row of a copied company came from when the catalogue was split
   * by company. The original company keeps every ID and has no rows here; a copy and
   * a rekeyed cost or quant row each record their source ID once, in their company.
   */
  CatalogueIdentityMapping: {
    scope: 'company',
    fields: {
      id: 'id',
      model: 'text',
      sourceId: 'text',
      targetId: 'text',
      createdAt: 'datetime',
    },
    indexes: {
      source: { fields: ['companyId', 'model', 'sourceId'], unique: true },
      target: { fields: ['model', 'targetId'] },
    },
  },
}
