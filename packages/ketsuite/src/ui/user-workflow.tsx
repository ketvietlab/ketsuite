import {
  Button,
  DescriptionList,
  Field,
  FormActions,
  FormGrid,
  LinkButton,
  Notice,
  Section,
  Stack,
  StagePath,
  Surface,
} from '@ketvietlab/design-system'
import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export type UserRoleOption = { id: string; name: string; description?: string }
export type UserWorkflowValues = Record<string, string>
export type UserWorkflowOptions = {
  /** Reads `user_backend.create.*`, in the language of the page. */
  t: Translator
  action: string
  cancelHref: string
  values: UserWorkflowValues
  step: number
  error?: string
  fieldErrors?: Readonly<Record<string, string | null | undefined>>
  companies: Array<{ id: string; name: string }>
  branches: Array<{ id: string; name: string; companyId: string; isRoot?: boolean }>
  roles: UserRoleOption[]
  emailCheckUrl: string
  /**
   * The company and branch pickers of the workplace step: `RelationSelect` islands the route renders
   * (`workplaceControls` beside the deployment's screen), the branch one reading the chosen company's
   * branches. Without them the step falls back to plain selects.
   */
  workplace?: { company: JSXChild; branch: JSXChild }
}

const STEPS = ['identity', 'workplace', 'roles', 'confirm'] as const
const word = (t: Translator, key: string): string => t(`user_backend.create.${key}`)

/** Where the person creating an account stands among the four steps, for the `RecordPage` `path`. */
export const userWorkflowPath = (step: number, t: Translator): TemplateResult => (
  <StagePath
    label={word(t, 'steps')}
    completeLabel={word(t, 'stepDone')}
    steps={STEPS.map((key, index) => ({
      id: `step-${index}`,
      label: word(t, `step.${key}`),
      state: index < step ? 'complete' : index === step ? 'current' : 'upcoming',
    }))}
  />
)

const selectedRoles = (values: UserWorkflowValues): string[] =>
  Object.keys(values)
    .filter((key) => key.startsWith('role.'))
    .map((key) => key.slice(5))

/** Goes back to the step that owns a reviewed group without checking the fields in between. */
const edit = (step: number, label: string) => (
  <Button label={label} variant="tertiary" type="submit" name="step" value={String(step)} formNoValidate />
)

/**
 * The four-step create-user form: one card per step, the steps already done carried as hidden values.
 * The client script (`client/user-workflow.ts`) checks the email while it is typed; the branch picker
 * reads the chosen company's branches. The server checks both again when the step is submitted.
 */
export const UserWorkflow = (o: UserWorkflowOptions): TemplateResult => {
  const v = o.values,
    t = o.t,
    errors = o.fieldErrors ?? {},
    selected = selectedRoles(v)
  // Fields of the current step post themselves; every other value rides along unchanged.
  const shown = (key: string) =>
    o.step === 0
      ? ['name', 'login', 'email'].includes(key)
      : o.step === 1
        ? key === 'companyId' || key === 'branchId'
        : o.step === 2 && key.startsWith('role.')
  const carried = Object.entries(v).filter(
    ([key]) => !shown(key) && !['step', 'command', 'currentStep'].includes(key),
  )
  const branches = o.branches.filter((branch) => !branch.isRoot)
  const body: JSXChild =
    o.step === 0 ? (
      <FormGrid
        items={[
          <Field
            id="create-user-name"
            name="name"
            label={word(t, 'field.name')}
            value={v.name ?? ''}
            required
            error={errors.name}
            autocomplete="off"
          />,
          <Field
            id="create-user-login"
            name="login"
            label={word(t, 'field.login')}
            value={v.login ?? ''}
            required
            error={errors.login}
            autocomplete="off"
          />,
          <Field
            id="create-user-email"
            name="email"
            label={word(t, 'field.email')}
            type="email"
            value={v.email ?? ''}
            required
            error={errors.email}
            help={word(t, 'field.emailHelp')}
            autocomplete="off"
          />,
        ]}
      />
    ) : o.step === 1 ? (
      <FormGrid
        items={[
          <Field
            id="create-user-company"
            name="companyId"
            label={word(t, 'field.company')}
            type="select"
            value={v.companyId ?? ''}
            required
            error={errors.companyId}
            control={o.workplace?.company}
            options={[
              { value: '', label: word(t, 'pick.company') },
              ...o.companies.map((company) => ({ value: company.id, label: company.name })),
            ]}
          />,
          <Field
            id="create-user-branch"
            name="branchId"
            label={word(t, 'field.branch')}
            type="select"
            value={v.branchId ?? ''}
            error={errors.branchId}
            help={word(t, 'field.branchHelp')}
            control={o.workplace?.branch}
            options={[
              { value: '', label: word(t, 'pick.branch') },
              ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
            ]}
          />,
        ]}
      />
    ) : o.step === 2 ? (
      o.roles.length === 0 ? (
        <Notice
          tone="info"
          title={word(t, 'roles.emptyTitle')}
          message={word(t, 'roles.emptyHint')}
          announcement="off"
        />
      ) : (
        <FormGrid
          items={o.roles.map((role, index) => (
            <Field
              id={`create-user-role-${index}`}
              name={`role.${role.id}`}
              label={role.name}
              type="checkbox"
              checked={selected.includes(role.id)}
              help={role.description || null}
            />
          ))}
        />
      )
    ) : (
      <Stack
        divided
        items={[
          <Section
            title={word(t, 'step.identity')}
            actions={edit(0, word(t, 'edit.identity'))}
            body={
              <DescriptionList
                items={[
                  { id: 'name', label: word(t, 'field.name'), value: v.name ?? '' },
                  { id: 'login', label: word(t, 'field.login'), value: v.login ?? '' },
                  { id: 'email', label: word(t, 'field.email'), value: v.email ?? '' },
                ]}
              />
            }
          />,
          <Section
            title={word(t, 'step.workplace')}
            actions={edit(1, word(t, 'edit.workplace'))}
            body={
              <DescriptionList
                items={[
                  {
                    id: 'company',
                    label: word(t, 'field.company'),
                    value: o.companies.find((company) => company.id === v.companyId)?.name ?? '',
                  },
                  {
                    id: 'branch',
                    label: word(t, 'field.branch'),
                    value:
                      o.branches.find((branch) => branch.id === v.branchId)?.name ??
                      word(t, 'review.noBranch'),
                  },
                ]}
              />
            }
          />,
          <Section
            title={word(t, 'step.roles')}
            actions={edit(2, word(t, 'edit.roles'))}
            body={
              <DescriptionList
                columns={1}
                items={[
                  {
                    id: 'roles',
                    label: word(t, 'field.roles'),
                    value:
                      o.roles
                        .filter((role) => selected.includes(role.id))
                        .map((role) => role.name)
                        .join(', ') || word(t, 'review.noRoles'),
                  },
                ]}
              />
            }
          />,
        ]}
      />
    )
  const actions = [
    o.step < 3 ? (
      <Button
        label={word(t, 'next')}
        variant="primary"
        type="submit"
        name="step"
        value={String(o.step + 1)}
      />
    ) : (
      <Button label={word(t, 'confirm')} variant="primary" type="submit" name="command" value="confirm" />
    ),
    o.step > 0 ? (
      <Button label={word(t, 'back')} type="submit" name="step" value={String(o.step - 1)} formNoValidate />
    ) : null,
    <LinkButton label={word(t, 'cancel')} variant="tertiary" href={o.cancelHref} />,
  ].filter((action) => action !== null)
  const titles = ['step.identity', 'step.workplace', 'roles.title', 'review.title']
  const descriptions = [null, 'workplace.description', 'roles.description', 'review.description']
  const description = descriptions[o.step]
  return (
    <form
      method="post"
      action={o.action}
      data-user-workflow
      data-email-check={o.emailCheckUrl}
      data-email-messages={JSON.stringify(
        Object.fromEntries(
          ['checking', 'available', 'taken', 'invalid', 'unknown'].map((key) => [
            key,
            word(t, `email.${key}`),
          ]),
        ),
      )}
    >
      {carried.map(([name, value]) => (
        <input type="hidden" name={name} value={value} autocomplete="off" />
      ))}
      <input type="hidden" name="currentStep" value={String(o.step)} autocomplete="off" />
      <Surface
        title={word(t, titles[o.step] ?? titles[0]!)}
        description={description ? word(t, description) : null}
        body={
          <Stack
            items={[
              o.error ? (
                <Notice
                  tone="danger"
                  title={word(t, o.step === 3 ? 'failedTitle' : 'errorTitle')}
                  message={o.error}
                />
              ) : null,
              body,
              <FormActions actions={actions} />,
            ]}
          />
        }
      />
    </form>
  )
}
