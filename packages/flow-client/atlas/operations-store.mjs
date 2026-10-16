import { taskColumns } from '@ketvietlab/flow-client/project-catalogs.mjs'
import { canManageScope, accessFor } from '@ketvietlab/flow-client/access-model.mjs'
const fail = (message, fields = {}) => ({
  ok: true,
  value: { ok: false, errors: [{ code: 'validation', message }], fields },
})
const denied = () => ({
  ok: true,
  value: { ok: false, errors: [{ code: 'forbidden', message: 'Bạn chưa có quyền thực hiện thao tác này.' }] },
})
export function seedOperations(d) {
  d.operationsRevision = 1
  d.formResponses = []
  d.personalPreferences = { theme: 'light', timezone: d.timezone, notifications: 'mentions' }
  for (const f of d.forms)
    Object.assign(f, {
      responses: 0,
      access: 'internal',
      assignee: 'Mai Anh',
      priority: 'normal',
      fields: [{ id: 'details', label: 'Chi tiết yêu cầu', type: 'textarea', required: true }],
      status: 'published',
    })
  for (const n of d.inbox)
    Object.assign(n, {
      createdAt: '2026-09-21T08:30:00Z',
      kind: n.title.includes('nhắc') ? 'mention' : 'update',
      actorId: n.title.includes('nhắc') ? 'ha' : 'bao',
    })
}
export function operationsCommand(d, args, scenario, replay, baseCall) {
  if (['readonly', 'guest', 'revoked'].includes(scenario)) return denied()
  if (!d.members.some((m) => m.id === d.user.id && m.status === 'active' && m.role !== 'guest'))
    return denied()
  if (!args.idempotencyKey) return fail('Thiếu khóa thao tác.')
  const key = d.company.id + ':operations:' + args.idempotencyKey
  if (replay.has(key)) return structuredClone(replay.get(key))
  if (args.expectedRevision !== d.operationsRevision)
    return {
      ok: true,
      value: {
        ok: false,
        errors: [{ code: 'conflict', message: 'Dữ liệu đã thay đổi. Tải lại trước khi tiếp tục.' }],
      },
    }
  const a = args.action
  let value = {}
  const project = d.projects.find((p) => p.id === args.projectId && !p.archived)
  if (
    a === 'form.submit' &&
    (!project || !['editor', 'member', 'admin', 'owner'].includes(accessFor(d, project, d.user.id).role))
  )
    return denied()
  const manager = canManageScope(d, 'company', d.company.id)
  if (a === 'form.save') {
    if (!project || !canManageScope(d, 'project', project.id)) return denied()
  }
  if (a === 'form.save') {
    if (typeof args.title !== 'string' || !args.title.trim())
      return fail('Nhập tên biểu mẫu.', { title: 'Tên biểu mẫu là bắt buộc.' })
    if (args.description !== undefined && typeof args.description !== 'string')
      return fail('Hướng dẫn phải là văn bản.', { description: 'Nhập hướng dẫn bằng văn bản.' })
    if (!['internal', 'project'].includes(args.access)) return fail('Chọn phạm vi gửi biểu mẫu.')
    if (
      !Array.isArray(args.fields) ||
      args.fields.length > 12 ||
      args.fields.some(
        (f) =>
          !f ||
          typeof f.label !== 'string' ||
          !f.label.trim() ||
          !['text', 'textarea', 'number'].includes(f.type) ||
          (f.required !== undefined && typeof f.required !== 'boolean'),
      )
    )
      return fail('Mỗi trường cần tên và kiểu dữ liệu, tối đa 12 trường.')
    const recipient = d.members.find(
      (m) => m.name === args.assignee && m.status === 'active' && m.role !== 'guest',
    )
    if (!recipient || !accessFor(d, project, recipient.id).role)
      return fail('Chọn người tiếp nhận đang hoạt động trong dự án.', {
        assignee: 'Chọn người tiếp nhận hợp lệ.',
      })
    if (args.priority !== undefined && !['normal', 'high', 'urgent'].includes(args.priority))
      return fail('Chọn mức ưu tiên.', { priority: 'Mức ưu tiên không hợp lệ.' })
    if (args.publish !== undefined && typeof args.publish !== 'boolean')
      return fail('Trạng thái xuất bản không hợp lệ.', { publish: 'Chọn trạng thái xuất bản.' })
    let f = d.forms.find((f) => f.id === args.id)
    if (args.id && (!f || f.projectId !== project.id)) return denied()
    if (!f) {
      f = { id: crypto.randomUUID(), projectId: project.id, responses: 0 }
      d.forms.push(f)
    }
    Object.assign(f, {
      title: args.title.trim(),
      description: args.description ?? f.description ?? '',
      access: args.access,
      assignee: args.assignee,
      priority: args.priority ?? f.priority ?? 'normal',
      fields: args.fields.map((x, i) => ({
        label: x.label.trim(),
        type: x.type,
        id: 'field-' + i,
        required: x.required ?? false,
      })),
      status: args.publish === undefined ? (f.status ?? 'draft') : args.publish ? 'published' : 'draft',
    })
    value = { id: f.id }
  } else if (a === 'form.submit') {
    const f = d.forms.find((f) => f.id === args.id && f.projectId === project?.id && f.status === 'published')
    if (!f) return fail('Biểu mẫu chưa được xuất bản.')
    if (typeof args.title !== 'string' || !args.title.trim())
      return fail('Nhập tiêu đề yêu cầu.', { 'request-title': 'Tiêu đề là bắt buộc.' })
    if (
      args.answers !== undefined &&
      (!args.answers || typeof args.answers !== 'object' || Array.isArray(args.answers))
    )
      return fail('Câu trả lời không hợp lệ.')
    for (const field of f.fields) {
      const v = args.answers?.[field.id]
      const errorField = 'answer-' + field.id
      if (v !== undefined && typeof v !== 'string' && typeof v !== 'number')
        return fail(`Câu trả lời cho ${field.label} không hợp lệ.`, { [errorField]: 'Nhập văn bản hoặc số.' })
      if (field.required && !String(v ?? '').trim())
        return fail(`Vui lòng nhập ${field.label}.`, { [errorField]: 'Trường này là bắt buộc.' })
      if (field.type === 'number' && String(v ?? '').trim() && !Number.isFinite(Number(v)))
        return fail(`${field.label} phải là số.`, { [errorField]: 'Nhập số hợp lệ.' })
    }
    const response = baseCall('flow.issue.save', {
      title: args.title,
      description: f.fields.map((field) => `${field.label}: ${args.answers?.[field.id] ?? ''}`).join('\n'),
      projectId: f.projectId,
      assignee: f.assignee,
      priority: f.priority,
      idempotencyKey: args.idempotencyKey + ':task',
    })
    if (!response?.ok || response.value?.ok === false) return response
    if (!response.value?.id) return fail('Không tạo được công việc. Vui lòng thử lại.')
    f.responses++
    d.formResponses.unshift({
      id: crypto.randomUUID(),
      formId: f.id,
      taskId: response.value.id,
      title: args.title,
      answers: Object.fromEntries(f.fields.map((field) => [field.id, args.answers?.[field.id] ?? ''])),
      person: d.user.name,
      at: new Date().toISOString(),
    })
    value = { id: response.value.id }
  } else if (a === 'inbox.read') {
    if (!Array.isArray(args.ids) || args.ids.some((id) => typeof id !== 'string'))
      return fail('Chọn thông báo.')
    if (
      args.ids.some(
        (id) => !d.inbox.some((n) => n.id === id && (!n.recipientId || n.recipientId === d.user.id)),
      )
    )
      return denied()
    for (const n of d.inbox)
      if (args.ids.includes(n.id) && (!n.recipientId || n.recipientId === d.user.id)) n.read = true
  } else if (a === 'view.save') {
    const v = d.views.find((v) => v.id === args.id)
    if (
      !project ||
      !accessFor(d, project, d.user.id).role ||
      !v ||
      v.archived ||
      v.projectId !== project.id ||
      (v.ownerId && v.ownerId !== d.user.id && !manager)
    )
      return denied()
    if (args.archive !== undefined && typeof args.archive !== 'boolean')
      return fail('Thao tác lưu trữ không hợp lệ.')
    if (args.archive) v.archived = true
    else {
      if (typeof args.title !== 'string' || !args.title.trim())
        return fail('Nhập tên view.', { title: 'Tên view là bắt buộc.' })
      if (args.description !== undefined && typeof args.description !== 'string')
        return fail('Ghi chú phải là văn bản.', { description: 'Nhập ghi chú bằng văn bản.' })
      if (args.query !== undefined && typeof args.query !== 'string')
        return fail('Truy vấn phải là văn bản.', { query: 'Nhập truy vấn bằng văn bản.' })
      if (args.visibility !== undefined && !['private', 'project'].includes(args.visibility))
        return fail('Chọn phạm vi chia sẻ.', { visibility: 'Phạm vi không hợp lệ.' })
      if (
        args.status !== undefined &&
        args.status !== 'all' &&
        !taskColumns(d, project.id).some((c) => c.id === args.status)
      )
        return fail('Chọn trạng thái trong dự án.', { status: 'Trạng thái không hợp lệ.' })
      Object.assign(v, {
        title: args.title.trim(),
        description: args.description ?? v.description ?? '',
        visibility: args.visibility ?? v.visibility ?? 'private',
        ownerId: v.ownerId ?? d.user.id,
        query: args.query ?? v.query ?? '',
        status: args.status ?? v.status ?? 'all',
      })
    }
  } else if (a === 'preferences.save') {
    if (args.notifications !== undefined && !['all', 'mentions', 'none'].includes(args.notifications))
      return fail('Chọn tùy chọn thông báo.', { notifications: 'Tùy chọn không hợp lệ.' })
    if (args.timezone !== undefined && (typeof args.timezone !== 'string' || !args.timezone.trim()))
      return fail('Múi giờ không hợp lệ.', { timezone: 'Chọn múi giờ hợp lệ.' })
    if (args.timezone !== undefined)
      try {
        new Intl.DateTimeFormat('vi', { timeZone: args.timezone }).format(new Date())
      } catch {
        return fail('Múi giờ không hợp lệ.', { timezone: 'Chọn múi giờ hợp lệ.' })
      }
    Object.assign(d.personalPreferences, {
      timezone: args.timezone ?? d.personalPreferences.timezone,
      notifications: args.notifications ?? d.personalPreferences.notifications,
    })
  } else return fail('Thao tác chưa được hỗ trợ.')
  d.operationsRevision++
  const result = { ok: true, value }
  replay.set(key, structuredClone(result))
  return result
}
