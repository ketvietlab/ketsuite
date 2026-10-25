import type { ModelDef } from '@ketvietlab/ketjs'
import { importModels } from './import-models.ts'

export const models: Record<string, ModelDef> = {
  ...importModels,
  Team: {
    scope: 'company',
    fields: {
      id: 'id',
      code: 'text',
      name: 'text',
      active: 'bool',
      leaderUserId: 'ref:user.User?',
      assignmentMode: 'text',
      assignmentCursor: 'int',
      version: 'int',
    },
    indexes: {
      code: { fields: ['companyId', 'code'], unique: true },
      active_name: { fields: ['companyId', 'active', 'name'] },
    },
  },
  TeamMember: {
    scope: 'company',
    fields: {
      id: 'id',
      teamId: 'ref:crm.Team',
      userId: 'ref:user.User',
      capacity: 'int',
      sequence: 'int',
      active: 'bool',
      assignedCount: 'int',
      lastAssignedAt: 'datetime?',
    },
    indexes: {
      identity: { fields: ['companyId', 'teamId', 'userId'], unique: true },
      routing: { fields: ['companyId', 'teamId', 'active', 'sequence'] },
    },
  },
  /**
   * Retired: record access now comes from the `crm.scope.team` and
   * `crm.scope.company` role permissions, and nothing reads or writes this. It
   * stays declared because removing a model is a breaking schema change; drop it
   * with the next deliberate schema clean-up.
   */
  AccessGrant: {
    scope: 'company',
    fields: {
      id: 'id',
      userId: 'ref:user.User',
      viewScope: 'text',
      editScope: 'text',
      assignScope: 'text',
      active: 'bool',
      version: 'int',
    },
    indexes: {
      user: { fields: ['companyId', 'userId'], unique: true },
    },
  },
  GamificationProfile: {
    scope: 'company',
    fields: {
      id: 'id',
      userId: 'ref:user.User',
      points: 'int',
      assigned: 'int',
      won: 'int',
      lost: 'int',
      activitiesDone: 'int',
      streak: 'int',
      refreshedAt: 'datetime',
    },
    indexes: {
      user: { fields: ['companyId', 'userId'], unique: true },
      leaderboard: { fields: ['companyId', 'points', 'userId'] },
    },
  },
  Stage: {
    scope: 'company',
    fields: {
      id: 'id',
      code: 'text',
      name: 'text',
      sequence: 'int',
      allowedKinds: 'json',
      terminalState: 'text',
      teamId: 'ref:crm.Team?',
      fold: 'bool',
      active: 'bool',
      version: 'int?',
      /** The win probability a record takes when it enters this stage; null keeps the record's own. */
      probability: 'decimal?',
      /** Days a record may stay in this stage before the pipeline flags it as stale; null or 0 never. */
      staleDays: 'int?',
    },
    indexes: {
      code: { fields: ['companyId', 'code'], unique: true },
      team_sequence: { fields: ['companyId', 'teamId', 'active', 'sequence'] },
    },
  },
  /**
   * Why a record was lost, as the company names it. `code` files it under one of the report's fixed
   * buckets (`LOST_REASON_CODES`); a reason without one reports as "other".
   */
  LostReason: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      code: 'text?',
      requiresNote: 'bool',
      sequence: 'int',
      active: 'bool',
      version: 'int?',
    },
    indexes: { sequence: { fields: ['companyId', 'active', 'sequence'] } },
  },
  Tag: {
    scope: 'company',
    fields: { id: 'id', name: 'text', color: 'text?', active: 'bool' },
    indexes: { name: { fields: ['companyId', 'name'], unique: true } },
  },
  Case: {
    scope: 'company',
    fields: {
      id: 'id',
      kind: 'text',
      /** Immutable acquisition kind; null identifies legacy records. */
      originKind: 'text?',
      /** Typed operational source; absent on manually created and legacy cases. */
      sourceKind: 'text?',
      waitingFor: 'text?',
      nextContactAt: 'datetime?',
      name: 'text',
      partnerId: 'ref:partner.Partner?',
      contactName: 'text?',
      email: 'text?',
      phone: 'text?',
      /**
       * The phone with the formatting taken out.
       *
       * Duplicate detection has to treat `+84 90 123 4567` and `0901234567` as
       * one number, and it cannot do that from SQL against the text a user
       * typed. Derived on write and indexed, so the match is a lookup rather
       * than a scan over whatever page the list function happened to return.
       */
      phoneDigits: 'text?',
      teamId: 'ref:crm.Team?',
      assigneeUserId: 'ref:user.User?',
      stageId: 'ref:crm.Stage',
      priority: 'text',
      description: 'text?',
      utmSource: 'text?',
      utmMedium: 'text?',
      utmCampaign: 'text?',
      terminalState: 'text',
      active: 'bool',
      version: 'int',
      score: 'decimal',
      mergedIntoId: 'ref:crm.Case?',
      threadId: 'ref:mail.Thread',
      createdByUserId: 'ref:user.User?',
      createdAt: 'datetime',
      updatedAt: 'datetime',
      convertedAt: 'datetime?',
      closedAt: 'datetime?',
      closedAssigneeUserId: 'ref:user.User?',
      closedTeamId: 'ref:crm.Team?',
      /** Distinguishes a recorded unassigned close from missing legacy history. */
      closedOwnershipRecordedAt: 'datetime?',
      /** When the record entered its current stage; null on records older than this field. */
      stageEnteredAt: 'datetime?',
      /** The open stage a won or lost record closed from, so reopening returns it there. */
      closedFromStageId: 'ref:crm.Stage?',
      /** The contact agreed to be contacted; email from the record needs it. Null is not given. */
      contactConsent: 'bool?',
    },
    indexes: {
      source_work: { fields: ['companyId', 'kind', 'sourceKind', 'assigneeUserId', 'terminalState'] },
      pipeline: { fields: ['companyId', 'kind', 'active', 'stageId', 'priority'] },
      assignee: { fields: ['companyId', 'assigneeUserId', 'active', 'updatedAt'] },
      partner: { fields: ['companyId', 'partnerId', 'active'] },
      email: { fields: ['companyId', 'email', 'active'] },
      phone: { fields: ['companyId', 'phoneDigits', 'active'] },
    },
  },
  CaseTag: {
    scope: 'company',
    fields: { id: 'id', caseId: 'ref:crm.Case', tagId: 'ref:crm.Tag', createdAt: 'datetime?' },
    indexes: { identity: { fields: ['companyId', 'caseId', 'tagId'], unique: true } },
  },
  SalesDetail: {
    scope: 'company',
    fields: {
      id: 'id',
      caseId: 'ref:crm.Case',
      expectedRevenue: 'decimal',
      recurringRevenue: 'decimal',
      probability: 'decimal',
      expectedClosing: 'date?',
      forecastCategory: 'text',
      lostReason: 'text?',
      lostReasonCode: 'text?',
      /** The configured reason a lost record gave; `lostReason` keeps its note. */
      lostReasonId: 'ref:crm.LostReason?',
      sourceLeadId: 'ref:crm.Case?',
    },
    indexes: { case: { fields: ['companyId', 'caseId'], unique: true } },
  },
  TimelineEntry: {
    scope: 'company',
    fields: {
      id: 'id',
      caseId: 'ref:crm.Case',
      eventType: 'text',
      actorUserId: 'ref:user.User?',
      customerVisible: 'bool',
      body: 'text',
      metadata: 'json?',
      occurredAt: 'datetime',
    },
    indexes: { case_time: { fields: ['companyId', 'caseId', 'occurredAt'] } },
  },
  Message: {
    scope: 'company',
    fields: {
      id: 'id',
      caseId: 'ref:crm.Case',
      actorUserId: 'ref:user.User?',
      authorPartnerId: 'ref:partner.Partner?',
      visibility: 'text',
      // An email to the customer carries its channel, its direction and its subject; a note carries none.
      channel: 'text?',
      direction: 'text?',
      subject: 'text?',
      body: 'text',
      createdAt: 'datetime',
    },
    indexes: { case_time: { fields: ['companyId', 'caseId', 'createdAt'] } },
  },
  ActivityLink: {
    scope: 'company',
    fields: { id: 'id', caseId: 'ref:crm.Case', activityId: 'ref:activity.Activity' },
    indexes: {
      activity: { fields: ['companyId', 'activityId'], unique: true },
      case: { fields: ['companyId', 'caseId'] },
    },
  },
  CalendarLink: {
    scope: 'company',
    fields: { id: 'id', caseId: 'ref:crm.Case', eventId: 'ref:calendar.Event' },
    indexes: {
      event: { fields: ['companyId', 'eventId'], unique: true },
      case: { fields: ['companyId', 'caseId'] },
    },
  },
  AssignmentRule: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      priority: 'int',
      allowedKinds: 'json',
      teamId: 'ref:crm.Team',
      assigneeUserId: 'ref:user.User?',
      utmSource: 'text?',
      minimumScore: 'decimal?',
      active: 'bool',
      version: 'int?',
    },
    indexes: { priority: { fields: ['companyId', 'active', 'priority'] } },
  },
  ScoreRule: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      field: 'text',
      operator: 'text',
      value: 'text',
      points: 'decimal',
      active: 'bool',
      sequence: 'int',
      version: 'int?',
    },
    indexes: { sequence: { fields: ['companyId', 'active', 'sequence'] } },
  },
  ScoreHistory: {
    scope: 'company',
    fields: { id: 'id', caseId: 'ref:crm.Case', score: 'decimal', reasons: 'json', calculatedAt: 'datetime' },
    indexes: { case_time: { fields: ['companyId', 'caseId', 'calculatedAt'] } },
  },
}
