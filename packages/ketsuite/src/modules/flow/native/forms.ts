import { randomUUID } from 'node:crypto'
import { eq, from } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { advanceRevision, cas, hash, lock, mutate, now } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { authority, FlowRefusal, owned, refuse, requireCapability, string } from './policy.ts'
import { requiredTitle, timestamped } from './organization.ts'
import { writeTask } from './tasks.ts'

export async function saveForm(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const previous = input.id ? await owned(ctx, 'flow.InternalForm', input.id) : null,
    projectId = previous?.projectId ?? input.projectId
  return mutate(
    ctx,
    { name: 'flow.form.save', capability: 'project.manage', input: { ...input, projectId } },
    extensions,
    async (tx) => {
      const id = previous ? string(previous.id) : randomUUID()
      await lock(tx, 'form:' + id)
      const old = previous ? await owned(tx, 'flow.InternalForm', id) : null
      if (old?.archived) return refuse('archived')
      if (input.projectId && input.projectId !== projectId)
        return refuse('validation', { projectId: 'immutable' })
      const fields = input.fields
      if (!Array.isArray(fields) || !fields.length || fields.length > 12)
        return refuse('validation', { fields: 'invalid' })
      const schemaFields = fields.map((f: Row) => {
        if (
          !f ||
          !string(f.label) ||
          string(f.label).length > 240 ||
          !['text', 'textarea', 'number'].includes(string(f.type)) ||
          (f.required !== undefined && typeof f.required !== 'boolean')
        )
          return refuse('validation', { fields: 'invalid' })
        const fieldId = f.id === undefined ? randomUUID() : string(f.id)
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(fieldId)) return refuse('validation', { fields: 'invalid_id' })
        return { id: fieldId, label: string(f.label), type: f.type, required: Boolean(f.required) }
      })
      if (new Set(schemaFields.map((f) => f.id)).size !== schemaFields.length)
        return refuse('validation', { fields: 'duplicate_id' })
      const _a = await authority(tx),
        M = tx.table('flow.Member'),
        U = tx.table('user.User')
      const member = await tx.db.one(
        from(M).where(
          eq(M.companyId, tx.scope.company),
          eq(M.userId, input.assigneeId),
          eq(M.status, 'active'),
        ),
      )
      if (!member || member.role === 'guest') return refuse('validation', { assignee: 'invalid' })
      // A recipient who cannot open the project is an invalid choice, not the actor's refusal.
      await requireCapability({ ...tx, actor: string(member.userId) }, 'project.read', { projectId }).catch(
        (error) =>
          error instanceof FlowRefusal && error.code === 'forbidden'
            ? refuse('validation', { assignee: 'invalid' })
            : Promise.reject(error),
      )
      const user = await tx.db.one(from(U).where(eq(U.id, member.userId), eq(U.active, true)))
      if (
        !user ||
        !['internal', 'project'].includes(string(input.access)) ||
        !['normal', 'high', 'urgent'].includes(string(input.priority ?? 'normal'))
      )
        return refuse('validation')
      const schemaRevision =
        Number(old?.schemaRevision ?? (old?.state === 'published' ? old.version : 0)) +
        (input.publish === true ? 1 : 0)
      const patch = {
        title: requiredTitle(input),
        description: string(input.description),
        state: input.publish === true ? 'published' : 'draft',
        schemaRevision,
        schema: {
          fields: schemaFields,
          access: input.access,
          priority: input.priority ?? 'normal',
          assigneeId: member.userId,
        },
      }
      if (old) await cas(tx, 'flow.InternalForm', id, input.expectedVersion, patch)
      else await tx.db.insert('flow.InternalForm', { id, projectId, ...timestamped(), ...patch })
      if (input.publish === true)
        await tx.db.insert('flow.FormSchema', {
          id: hash(JSON.stringify([tx.scope.company, id, schemaRevision])),
          formId: id,
          schemaRevision,
          schema: patch.schema,
          createdBy: tx.actor,
          createdAt: now(),
        })
      return { ok: true, id, schemaRevision, revision: await advanceRevision(tx, input, 'operations') }
    },
  )
}

export async function submitForm(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const old = await owned(ctx, 'flow.InternalForm', input.id)
  return mutate(
    ctx,
    { name: 'flow.form.submit', capability: 'project.write', input: { ...input, projectId: old.projectId } },
    extensions,
    async (tx) => {
      await lock(tx, 'form:' + old.id)
      const form = await owned(tx, 'flow.InternalForm', old.id)
      if (form.archived || form.state !== 'published') return refuse('form_unpublished')
      if (form.version !== input.expectedVersion) return refuse('conflict')
      const a = await authority(tx)
      const schema = form.schema as Row,
        schemaRevision = Number(form.schemaRevision ?? form.version),
        fields = schema.fields as Row[]
      if (schema.access === 'internal' && a.member?.role === 'guest') return refuse('forbidden')
      if (input.expectedSchemaRevision !== undefined && input.expectedSchemaRevision !== schemaRevision)
        return refuse('conflict')
      if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers))
        return refuse('validation', { answers: 'invalid' })
      const answers = input.answers as Row,
        normalized: Row = {}
      for (const key of Object.keys(answers))
        if (!fields.some((f) => f.id === key)) return refuse('validation', { answers: 'unknown' })
      for (const field of fields) {
        const value = answers[string(field.id)],
          text = string(value)
        if (
          (value !== undefined && typeof value !== 'string' && typeof value !== 'number') ||
          text.length > 10000 ||
          (field.required && !text.trim()) ||
          (field.type !== 'number' && value !== undefined && typeof value !== 'string') ||
          (field.type === 'number' && text && !Number.isFinite(Number(text)))
        )
          return refuse('validation', { ['answer-' + field.id]: 'invalid' })
        normalized[string(field.id)] = field.type === 'number' && text ? Number(text) : text
      }
      const taskInput = {
        projectId: form.projectId,
        title: requiredTitle(input, 'title', 1000),
        description: fields.map((f) => string(f.label) + ': ' + normalized[string(f.id)]).join('\n'),
        assigneeIds: [schema.assigneeId],
        priority: schema.priority,
      }
      for (const extension of extensions)
        await extension.beforeMutation?.(tx, {
          name: 'flow.issue.save',
          capability: 'project.write',
          input: taskInput,
        })
      const task = await writeTask(tx, taskInput, null)
      const T = tx.table('flow.Task'),
        row = await tx.db.one(from(T).where(eq(T.companyId, tx.scope.company), eq(T.key, task.id)))
      if (!row) throw new Error('Created task missing')
      await tx.db.insert('flow.FormResponse', {
        id: randomUUID(),
        formId: form.id,
        taskId: row.id,
        respondentId: tx.actor,
        schemaRevision,
        schemaSnapshot: schema,
        answers: normalized,
        createdAt: now(),
      })
      return { ok: true, id: task.id, revision: await advanceRevision(tx, input, 'operations') }
    },
  )
}
