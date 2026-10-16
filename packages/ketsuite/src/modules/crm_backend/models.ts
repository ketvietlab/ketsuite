import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  /**
   * An import the user previewed: what they pasted, the rows read from it and what each would do, then, once
   * confirmed, what the import did, so that confirming again returns it. It is theirs alone, and kept briefly.
   */
  SalesImportPreview: {
    scope: 'company',
    fields: {
      id: 'id',
      actorUserId: 'ref:user.User',
      input: 'json',
      headers: 'json',
      rows: 'json',
      diagnostics: 'json',
      valid: 'bool',
      result: 'json?',
      createdAt: 'datetime',
    },
    indexes: { actor_time: { fields: ['companyId', 'actorUserId', 'createdAt'] } },
  },
}
