import {
  AppSwitcherHelp,
  Button,
  DescriptionList,
  Notice,
  RecordActions,
  Stack,
} from '@ketvietlab/design-system'
import type { FieldProps, RelationSelectConfig } from '@ketvietlab/design-system'
import { createRecordModal, recordIsland } from '../../../ui/client/record-modal.tsx'
import type {
  RecordModalContext,
  RecordModalDefinition,
  RecordModalDialog,
} from '../../../ui/client/record-modal.tsx'
import {
  RecordCloseTrigger,
  RecordDialogTrigger,
  RecordModalForm,
} from '../../../ui/client/record-modal-form.tsx'
import type { TeamModalData } from './shared.ts'
import { SaleTeamHelp } from './help.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
type Context = RecordModalContext<TeamModalData>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`sale_backend.team.${key}`)
const formId = 'sale-team-form'
const confirmation = (name: 'archive' | 'restore'): RecordModalDialog<TeamModalData> => ({
  title: (c) => t(c, name),
  view: (c) => <RecordModalForm id={`sale-team-${name}`} kind={c.kind} command={name} fields={[]} />,
  confirmation: {
    message: (c) => t(c, `${name}Body`),
    label: (c) => t(c, name),
    cancelLabel: (c) => t(c, 'cancel'),
    form: () => `sale-team-${name}`,
    command: name,
    variant: name === 'archive' ? 'destructive' : 'primary',
    disabled: (c) => c.busy || !c.data.permissions.lifecycle,
  },
})
const field = (c: Context, name: string, props: Partial<FieldProps> = {}): FieldProps => ({
  id: `${formId}-${name}`,
  name,
  label: t(c, name),
  value: c.draft(name, String(c.data.record[name as keyof TeamModalData['record']] ?? '')),
  error: c.fieldError(name),
  disabled: c.busy,
  ...props,
})
/** The design system's picker over the company's people: the leader is one, the members several. */
const people = (c: Context, name: 'leaderId' | 'memberIds', multiple: boolean): FieldProps => {
  const base = field(c, name, { required: !multiple, help: multiple ? t(c, 'membersHelp') : undefined })
  const labels = Object.fromEntries(
    [
      'choose',
      'search',
      'more',
      'noRecords',
      'loading',
      'loadError',
      'close',
      'select',
      'retry',
      'clear',
      'chosen',
    ].map((word) => [word, c.t(`backend.relation.${word}`)]),
  ) as Omit<RelationSelectConfig['labels'], 'dialogTitle'>
  const config: RelationSelectConfig = {
    name,
    triggerId: base.id,
    ariaLabel: String(base.label),
    ...(multiple
      ? { multiple: true, value: null, values: c.data.record.memberIds }
      : { value: c.data.record.leaderId || null }),
    required: !multiple,
    options: c.data.choices.salespeople.map((row) => ({ value: row.id, label: row.name })),
    invalid: Boolean(base.error),
    describedBy: base.error ? `${base.id}-error` : undefined,
    labels: { ...labels, dialogTitle: String(base.label) },
    disabled: c.busy,
  }
  return { ...base, control: recordIsland('backend.relation-select', { id: base.id!, config }) }
}
export const saleTeamModalDefinition: RecordModalDefinition<TeamModalData> = {
  kind: 'sale.team',
  size: 'small',
  labels: () => {
    const vi = lang() === 'vi'
    return {
      ...USER_RECORD_MODAL_LABELS[lang()],
      'recordModal.loadFailed': vi ? 'Không đọc được đội.' : 'The team could not be read.',
      'recordModal.notFound': vi
        ? 'Đội không tồn tại hoặc bạn không có quyền xem.'
        : 'The team is gone or you cannot view it.',
      'recordModal.saved': vi ? 'Đã lưu đội.' : 'Team saved.',
    }
  },
  context: {
    route: (id, creating) => {
      const record = creating ? 'new' : encodeURIComponent(id)
      return `/admin/sales/teams/${record}/context?lang=${lang()}`
    },
    query: ['company', 'branch'],
  },
  title: (c) => t(c, c.creating ? 'createTitle' : c.data.permissions.edit ? 'editTitle' : 'viewTitle'),
  body: (c) => (
    <>
      <Stack
        items={[
          c.data.permissions.edit ? (
            <RecordModalForm
              kind={c.kind}
              id={formId}
              command="save"
              columns={1}
              fields={[
                field(c, 'name', { required: true, maxLength: 60, help: t(c, 'nameHelp') }),
                people(c, 'leaderId', false),
                people(c, 'memberIds', true),
                field(c, 'monthlyTarget', {
                  type: 'number',
                  min: 0,
                  step: '1',
                  inputMode: 'numeric',
                  help: t(c, 'monthlyTargetHelp'),
                }),
              ]}
            />
          ) : (
            <DescriptionList
              items={[
                { id: 'name', label: t(c, 'name'), value: c.data.record.name },
                { id: 'leader', label: t(c, 'leaderId'), value: c.data.display.leaderName },
                { id: 'members', label: t(c, 'memberIds'), value: c.data.display.memberNames },
                { id: 'target', label: t(c, 'monthlyTarget'), value: c.data.display.monthlyTarget },
              ]}
            />
          ),
          c.fieldError('expectedRevisionId') ? (
            <Notice tone="warning" title={c.fieldError('expectedRevisionId')!} message="" />
          ) : null,
          !c.creating ? (
            <DescriptionList
              items={[
                {
                  id: 'status',
                  label: t(c, 'status'),
                  value: t(c, c.data.record.active ? 'active' : 'archived'),
                },
              ]}
            />
          ) : null,
        ]}
      />
      <SaleTeamHelp lang={c.data.lang} id="sale-team-record-help" />
    </>
  ),
  actions: (c) => (
    <RecordActions
      actions={[
        <AppSwitcherHelp label={HELP[c.data.lang].trigger} />,
        ...(!c.creating && c.data.permissions.lifecycle
          ? [
              <RecordDialogTrigger dialog={c.data.record.active ? 'archive' : 'restore'}>
                <Button
                  label={t(c, c.data.record.active ? 'archive' : 'restore')}
                  variant="secondary"
                  disabled={c.busy}
                />
              </RecordDialogTrigger>,
            ]
          : []),
        <RecordCloseTrigger>
          <Button
            label={c.data.permissions.edit ? t(c, 'cancel') : c.t('recordModal.close')}
            variant="secondary"
          />
        </RecordCloseTrigger>,
        ...(c.data.permissions.edit
          ? [
              <Button
                type="submit"
                form={formId}
                label={t(c, c.creating ? 'create' : 'save')}
                variant="primary"
                loading={c.busy}
              />,
            ]
          : []),
      ]}
    />
  ),
  dialogs: { archive: confirmation('archive'), restore: confirmation('restore') },
  commands: {
    save: {
      fn: 'sale.saveTeam',
      input: (form, c) => ({
        id: c.data.record.id,
        ...(c.creating ? {} : { expectedRevisionId: c.data.record.revisionId }),
        name: String(form.get('name') ?? ''),
        leaderId: String(form.get('leaderId') ?? ''),
        // The picker posts its several values as one comma-joined field.
        memberIds: String(form.get('memberIds') ?? '')
          .split(',')
          .filter(Boolean),
        monthlyTarget: String(form.get('monthlyTarget') ?? ''),
      }),
      after: 'close',
    },
    archive: {
      fn: 'sale.setTeamActive',
      input: (_form, c) => ({ id: c.id, active: false, expectedRevisionId: c.data.record.revisionId }),
      after: 'reload',
    },
    restore: {
      fn: 'sale.setTeamActive',
      input: (_form, c) => ({ id: c.id, active: true, expectedRevisionId: c.data.record.revisionId }),
      after: 'reload',
    },
  },
}
export const saleTeamModal = createRecordModal(saleTeamModalDefinition)
