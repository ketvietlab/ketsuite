import type { ModelDef } from '@ketvietlab/ketjs'

/** The upload is a draft; only a worker may turn its frozen plan into CRM records. */
export const importModels: Record<string, ModelDef> = {
  ImportBatch: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      filename: 'text',
      actorUserId: 'ref:user.User',
      state: 'text',
      version: 'int',
      headers: 'json',
      data: 'json',
      mapping: 'json',
      rules: 'json',
      sheets: 'json',
      header: 'bool?',
      sheet: 'text?',
      source: 'text?',
      total: 'int',
      cursor: 'int',
      counts: 'json',
      createdAt: 'datetime',
      updatedAt: 'datetime',
      startedAt: 'datetime?',
      finishedAt: 'datetime?',
      undoUntil: 'datetime?',
      stoppedReason: 'text?',
    },
    indexes: {
      owner: { fields: ['companyId', 'actorUserId', 'createdAt'] },
      state: { fields: ['companyId', 'state', 'createdAt'] },
    },
  },
  ImportRow: {
    scope: 'company',
    fields: {
      id: 'id',
      batchId: 'ref:crm.ImportBatch',
      rowNumber: 'int',
      outcome: 'text',
      issue: 'text?',
      original: 'json',
      normalized: 'json',
      caseId: 'ref:crm.Case?',
      partnerId: 'ref:partner.Partner?',
      assigneeUserId: 'ref:user.User?',
      createdCase: 'bool',
      createdPartner: 'bool',
      caseVersion: 'int?',
      addedTags: 'json',
      addedCustomerLabels: 'json',
      activityId: 'ref:activity.Activity?',
      activitySnapshot: 'json?',
      processedAt: 'datetime',
      undoneAt: 'datetime?',
      undoResult: 'text?',
    },
    indexes: {
      identity: { fields: ['companyId', 'batchId', 'rowNumber'], unique: true },
      outcome: { fields: ['companyId', 'batchId', 'outcome', 'rowNumber'] },
      record: { fields: ['companyId', 'caseId'] },
    },
  },
  // Serialises import chunks across batches in one company. The version is acquired
  // before matching customers, so two concurrent files cannot both see an absent lead.
  ImportControl: {
    scope: 'company',
    fields: { id: 'id', version: 'int' },
  },
  CustomerLabel: {
    scope: 'company',
    fields: { id: 'id', name: 'text', normalizedName: 'text', active: 'bool' },
    indexes: { name: { fields: ['companyId', 'normalizedName'], unique: true } },
  },
  CustomerLabelLink: {
    scope: 'company',
    fields: { id: 'id', partnerId: 'ref:partner.Partner', labelId: 'ref:crm.CustomerLabel' },
    indexes: { identity: { fields: ['companyId', 'partnerId', 'labelId'], unique: true } },
  },
}
