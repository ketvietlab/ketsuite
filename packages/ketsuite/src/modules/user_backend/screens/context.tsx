import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { button, FormPage, RecordForm, Section, shell, Surface } from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type ContextCompany = { id: string; code: string; name: string }
export type ContextBranch = {
  id: string
  companyId: string
  code: string
  name: string
  isRoot?: boolean
}

export type ContextFormValues = {
  selectedBranches: readonly string[]
  companyId: string
  branchId: string
}

export type ContextScreenOptions = ContextFormValues & {
  companies: readonly ContextCompany[]
  branches: readonly ContextBranch[]
  action: string
  errors?: readonly string[]
}

/**
 * A session works in one company, so the company is a single choice. Branch reads
 * narrow within that company and list only its branches.
 */
export const contextFields = (_: Translator, options: ContextScreenOptions): FormField[] => {
  const companyNames = new Map(options.companies.map((company) => [company.id, company.name]))
  const branchName = (branch: ContextBranch) =>
    branch.isRoot ? `${_('user_backend.context.rootBranch')} · ${branch.code}` : branch.name
  const branchLabel = (branch: ContextBranch) =>
    `${companyNames.get(branch.companyId) ?? branch.companyId} / ${branchName(branch)}`
  return [
    {
      name: 'companyId',
      label: _('user_backend.context.activeCompany'),
      type: 'select',
      value: options.companyId,
      required: true,
      help: _('user_backend.context.companyHelp'),
      options: options.companies.map((company) => ({ value: company.id, label: company.name })),
    },
    {
      name: 'branchId',
      label: _('user_backend.context.activeBranch'),
      type: 'select',
      value: options.branchId,
      required: true,
      help: _('user_backend.context.branchHelp'),
      options: options.branches.map((branch) => ({ value: branch.id, label: branchLabel(branch) })),
    },
    ...options.branches
      .filter((branch) => branch.companyId === options.companyId)
      .map((branch) => ({
        name: `branch.${branch.id}`,
        label: `${_('user_backend.context.readBranch')}: ${branchName(branch)}`,
        type: 'checkbox' as const,
        value: options.selectedBranches.includes(branch.id),
        span: 'half' as const,
      })),
  ]
}

export const contextScreen = (_: Translator, frame: Frame, options: ContextScreenOptions): TemplateResult => {
  const formId = 'working-context-form'
  return shell(
    _,
    _('user_backend.context.title'),
    <FormPage
      variant="operational"
      frame={frame}
      scope="working-context-page"
      title={_('user_backend.context.title')}
      actions={button({
        label: _('user_backend.context.apply'),
        type: 'submit',
        form: formId,
        variant: 'primary',
      })}
      body={
        <Section
          title={_('user_backend.context.writeTitle')}
          body={
            <Surface
              body={
                <RecordForm
                  id={formId}
                  scope="working-context"
                  action={options.action}
                  hidden={{ action: 'save' }}
                  fields={contextFields(_, options)}
                  errors={options.errors}
                  submit={_('user_backend.context.apply')}
                  submitVariant="primary"
                  submitPlacement="external"
                />
              }
            />
          }
        />
      }
    />,
    { ...frame, topbar: false },
  )
}
