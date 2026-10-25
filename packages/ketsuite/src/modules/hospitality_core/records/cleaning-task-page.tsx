import {
  ActionGroup,
  Badge,
  Button,
  DescriptionList,
  LinkButton,
  Stack,
  Surface,
  Text,
} from '@ketvietlab/design-system'
import {
  createRecordPage,
  RecordDialogTrigger,
  RecordModalForm,
  recordIsland,
} from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext } from '../../../ui/client/record-modal.tsx'
import { CLEANING_CHECKS } from '../cleaning-checklist.ts'
type Row = Record<string, unknown>
export type CleaningTaskPageData = {
  record: Row
  locale: string
  scope: string
  commandKey: string
  dueLocal: string
  backHref: string
  can: Record<string, boolean>
}
type Context = RecordModalContext<CleaningTaskPageData>
const tr = (c: Context, key: string) => c.t(`hospitality_core.${key}`)
const label = (c: Context, key: string) => tr(c, `taskPage.${key}`)
const row = (value: unknown) => (value ?? {}) as Row
const shown = (value: unknown) => (value == null || value === '' ? '—' : String(value))
const time = (c: Context, value: unknown) =>
  value
    ? new Intl.DateTimeFormat(c.data.locale, {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: String(row(c.data.record.property).timezone),
      }).format(new Date(String(value)))
    : '—'
const eligible = (c: Context, action: string) =>
  c.data.can[action] &&
  (action === 'start'
    ? c.data.record.state === 'todo'
    : action === 'complete'
      ? c.data.record.state === 'in_progress'
      : ['todo', 'in_progress'].includes(String(c.data.record.state)))
const input = (c: Context, action: string) => ({
  id: c.id,
  expectedVersion: Number(c.data.record.version ?? 0),
  requestKey: `${c.data.commandKey}:${action}`,
})
const staff = (c: Context) =>
  recordIsland('backend.relation-select', {
    id: 'task-assignee',
    config: {
      name: 'assigneeId',
      ariaLabel: label(c, 'assignee'),
      value: c.draft('assigneeId', String(c.data.record.assigneeId ?? '')) || null,
      options: c.data.record.assigneeId
        ? [{ value: String(c.data.record.assigneeId), label: shown(c.data.record.assigneeName) }]
        : [],
      labels: Object.fromEntries(
        [
          'choose',
          'search',
          'more',
          'noRecords',
          'loading',
          'loadError',
          'dialogTitle',
          'close',
          'select',
          'create',
          'edit',
          'cancel',
          'remove',
          'confirmRemove',
          'retry',
          'clear',
          'chosen',
        ].map((key) => [key, tr(c, `collection.lookup.${key}`)]),
      ),
      manager: {
        listFunction: 'hospitality_core.lookupCleaningStaff',
        listInput: { propertyId: c.data.record.propertyId },
        requestQuery: c.data.scope,
        searchInDropdown: true,
        limit: 20,
        resolveParam: 'id',
        idField: 'id',
        labelField: 'name',
      },
    },
  })
export const cleaningTaskPage = createRecordPage<CleaningTaskPageData>(
  {
    kind: 'hospitality.cleaningTask',
    cache: false,
    size: 'large',
    context: {
      route: (id) => `/admin/hospitality/housekeeping/tasks/${encodeURIComponent(id)}/workspace-context`,
      query: ['company', 'companies', 'branch', 'branches', 'lang', 'returnTo'],
    },
    title: (c) => `${label(c, 'title')} ${shown(c.data.record.code)}`,
    body: (c) => (
      <Stack
        items={[
          <Surface
            title={label(c, 'details')}
            body={
              <DescriptionList
                items={[
                  { id: 'room', label: label(c, 'room'), value: shown(row(c.data.record.room).name) },
                  {
                    id: 'type',
                    label: label(c, 'type'),
                    value: tr(c, `cleaningType.${c.data.record.taskType}`),
                  },
                  {
                    id: 'assignee',
                    label: label(c, 'assignee'),
                    value: c.data.record.assigneeName
                      ? String(c.data.record.assigneeName)
                      : label(c, 'unassigned'),
                  },
                  {
                    id: 'priority',
                    label: label(c, 'priority'),
                    value: tr(c, `cleaningPriority.${c.data.record.priority}`),
                  },
                  { id: 'due', label: label(c, 'due'), value: time(c, c.data.record.dueAt) },
                  {
                    id: 'state',
                    label: label(c, 'state'),
                    value: (
                      <Badge
                        label={tr(c, `cleaningState.${c.data.record.state}`)}
                        tone={c.data.record.state === 'done' ? 'positive' : 'neutral'}
                      />
                    ),
                  },
                  { id: 'note', label: label(c, 'assignmentNote'), value: shown(c.data.record.notes) },
                  { id: 'started', label: label(c, 'started'), value: time(c, c.data.record.startedAt) },
                  ...(c.data.record.state === 'declined'
                    ? [
                        {
                          id: 'decline-reason',
                          label: label(c, 'declineReason'),
                          value: shown(c.data.record.declineReason),
                        },
                        {
                          id: 'declined-at',
                          label: label(c, 'declinedAt'),
                          value: time(c, c.data.record.declinedAt),
                        },
                        {
                          id: 'declined-by',
                          label: label(c, 'declinedBy'),
                          value: shown(c.data.record.declinedByName),
                        },
                      ]
                    : []),
                  { id: 'done', label: label(c, 'done'), value: time(c, c.data.record.doneAt) },
                  {
                    id: 'completed-by',
                    label: label(c, 'completedBy'),
                    value: shown(c.data.record.completedByName),
                  },
                ]}
              />
            }
          />,
          <Surface
            title={label(c, 'checklist')}
            body={
              <RecordModalForm
                kind={c.kind}
                id="cleaning-task-work"
                fields={[
                  {
                    id: 'task-checklist',
                    name: 'checklist',
                    label: label(c, 'checklist'),
                    type: 'checkbox-group',
                    disabled: !eligible(c, 'complete'),
                    error: c.fieldError('checklist'),
                    options: CLEANING_CHECKS.map((key) => ({
                      name: `check-${key}`,
                      value: 'yes',
                      label: label(c, `check.${key}`),
                      checked:
                        c.draft(
                          `check-${key}`,
                          Array.isArray(c.data.record.checklist) && c.data.record.checklist.includes(key)
                            ? 'yes'
                            : '',
                        ) === 'yes',
                    })),
                  },
                  {
                    id: 'task-completion-note',
                    name: 'completionNotes',
                    label: label(c, 'completionNote'),
                    type: 'textarea',
                    maxLength: 2000,
                    disabled: !eligible(c, 'complete'),
                    value: c.draft('completionNotes', String(c.data.record.completionNotes ?? '')),
                    error: c.fieldError('completionNotes'),
                  },
                ]}
              />
            }
          />,
        ]}
      />
    ),
    pageActions: (c) => (
      <ActionGroup
        actions={[
          <LinkButton label={label(c, 'back')} href={c.data.backHref} />,
          ...(['start', 'complete'] as const).map((action) =>
            eligible(c, action) ? (
              <Button
                form="cleaning-task-work"
                type="submit"
                name="__command"
                value={action}
                label={label(c, action)}
                variant="primary"
                disabled={c.busy}
              />
            ) : null,
          ),
          eligible(c, 'assign') ? (
            <RecordDialogTrigger dialog="assign">
              <Button label={label(c, 'assign')} variant="secondary" disabled={c.busy} />
            </RecordDialogTrigger>
          ) : null,
          eligible(c, 'decline') ? (
            <RecordDialogTrigger dialog="decline">
              <Button label={label(c, 'decline')} variant="secondary" disabled={c.busy} />
            </RecordDialogTrigger>
          ) : null,
          eligible(c, 'cancel') ? (
            <RecordDialogTrigger dialog="cancel">
              <Button label={label(c, 'cancel')} variant="secondary" disabled={c.busy} />
            </RecordDialogTrigger>
          ) : null,
        ]}
      />
    ),
    commands: {
      decline: {
        fn: 'hospitality_core.declineCleaningTask',
        input: (f, c) => ({ ...input(c, 'decline'), reason: String(f.get('reason') ?? '') }),
        after: 'reload',
      },
      start: {
        fn: 'hospitality_core.startCleaningTask',
        input: (_f, c) => input(c, 'start'),
        after: 'reload',
      },
      complete: {
        fn: 'hospitality_core.completeCleaningTask',
        input: (f, c) => ({
          ...input(c, 'complete'),
          checklist: CLEANING_CHECKS.filter((key) => f.get(`check-${key}`) === 'yes'),
          completionNotes: String(f.get('completionNotes') ?? ''),
        }),
        after: 'reload',
      },
      cancel: {
        fn: 'hospitality_core.cancelCleaningTask',
        input: (_f, c) => input(c, 'cancel'),
        after: 'reload',
      },
      assign: {
        fn: 'hospitality_core.saveCleaningTask',
        input: (f, c) => ({
          ...input(c, 'assign'),
          propertyId: c.data.record.propertyId,
          roomId: c.data.record.roomId,
          taskType: c.data.record.taskType,
          assigneeId: String(f.get('assigneeId') ?? '') || null,
          priority: String(f.get('priority') ?? ''),
          dueLocal: String(f.get('dueAt') ?? ''),
          notes: String(f.get('notes') ?? ''),
        }),
        after: 'reload',
      },
    },
    dialogs: {
      decline: {
        title: (c) => label(c, 'decline'),
        size: 'small',
        view: (c) => (
          <RecordModalForm
            kind={c.kind}
            id="task-decline-form"
            fields={[
              {
                id: 'task-decline-reason',
                name: 'reason',
                label: label(c, 'declineReason'),
                type: 'textarea',
                required: true,
                maxLength: 500,
                value: c.draft('reason', ''),
                error: c.fieldError('reason'),
              },
            ]}
          />
        ),
        actions: (c) =>
          eligible(c, 'decline') ? (
            <Button
              form="task-decline-form"
              type="submit"
              name="__command"
              value="decline"
              label={label(c, 'decline')}
              disabled={c.busy}
            />
          ) : null,
      },
      assign: {
        title: (c) => label(c, 'assign'),
        size: 'small',
        view: (c) =>
          eligible(c, 'assign') ? (
            <RecordModalForm
              kind={c.kind}
              id="task-assignment-form"
              fields={[
                {
                  id: 'task-assignee',
                  name: 'assigneeId',
                  label: label(c, 'assignee'),
                  control: staff(c),
                  error: c.fieldError('assigneeId'),
                },
                {
                  id: 'task-priority',
                  name: 'priority',
                  label: label(c, 'priority'),
                  type: 'select',
                  required: true,
                  value: c.draft('priority', String(c.data.record.priority)),
                  options: ['normal', 'urgent'].map((value) => ({
                    value,
                    label: tr(c, `cleaningPriority.${value}`),
                  })),
                },
                {
                  id: 'task-due',
                  name: 'dueAt',
                  label: label(c, 'due'),
                  type: 'datetime-local',
                  required: true,
                  locale: c.data.locale === 'en' ? 'en' : 'vi',
                  value: c.draft('dueAt', c.data.dueLocal),
                  error: c.fieldError('dueAt'),
                },
                {
                  id: 'task-assignment-note',
                  name: 'notes',
                  label: label(c, 'assignmentNote'),
                  type: 'textarea',
                  maxLength: 2000,
                  value: c.draft('notes', String(c.data.record.notes ?? '')),
                  error: c.fieldError('notes'),
                },
              ]}
            />
          ) : (
            <Text>{label(c, 'unavailable')}</Text>
          ),
        actions: (c) =>
          eligible(c, 'assign') ? (
            <Button
              form="task-assignment-form"
              type="submit"
              name="__command"
              value="assign"
              label={label(c, 'save')}
              disabled={c.busy}
            />
          ) : null,
      },
      cancel: {
        title: (c) => label(c, 'cancel'),
        view: (c) => <RecordModalForm kind={c.kind} id="task-cancel-form" fields={[]} />,
        confirmation: {
          message: (c) => label(c, 'cancelHint'),
          label: (c) => label(c, 'cancel'),
          cancelLabel: (c) => label(c, 'back'),
          form: () => 'task-cancel-form',
          command: 'cancel',
          variant: 'destructive',
          disabled: (c) => c.busy || !eligible(c, 'cancel'),
        },
      },
    },
  },
  { path: (id) => `/admin/hospitality/housekeeping/tasks/${encodeURIComponent(id)}` },
)
