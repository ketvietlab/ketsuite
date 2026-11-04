import { html, signal } from '@ketvietlab/ketjs-view'
import { tr } from './i18n.mjs'
import { FlowInput, FlowButton } from '@ketvietlab/flow-ui'
import { FlowEntryPage, FlowHint, FlowSelectField, FlowTextarea } from '@ketvietlab/flow-ui/workspace'
import { DEFAULT_CADENCE } from './sprint-cadence.mjs'

export const PASSWORD_MIN = 10
export const PROJECT_CODE = /^[A-Z][A-Z0-9]{1,11}$/
export const onboardingSteps = ['workspace', 'project', 'invite']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The deployment's login page, asked to return to where the session ran out. */
export function sharedSignIn() {
  const here = globalThis.location ? globalThis.location.pathname + globalThis.location.search : '/flow/'
  return `/login?next=${encodeURIComponent(here)}`
}

/** A project code suggested from its name: initials of up to four words, or the first four letters of a single word, without Vietnamese marks. Empty when no valid code comes out. */
export function projectCode(title) {
  const words =
    String(title)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/gi, 'd')
      .toUpperCase()
      .match(/[A-Z0-9]+/g) ?? []
  const code =
    words.length > 1
      ? words
          .slice(0, 4)
          .map((w) => w[0])
          .join('')
      : (words[0] ?? '').slice(0, 4)
  return PROJECT_CODE.test(code) ? code : ''
}

/** Addresses typed one per line or separated by commas: valid ones lowercased and deduplicated, the rest returned as typed. */
export function parseInvites(text) {
  const emails = [],
    invalid = []
  for (const raw of String(text).split(/[\s,;]+/)) {
    if (!raw) continue
    const email = raw.toLowerCase()
    if (!EMAIL.test(email)) invalid.push(raw)
    else if (!emails.includes(email)) emails.push(email)
  }
  return { emails, invalid }
}

/** The owner of a new organization before Flow has anything in it: create the first workspace, project and invitations.
 * Signing in belongs to the deployment, so an expired session links to its shared login. Atlas has no accounts and
 * supplies its own sign-in and password pages through `fixtureAuth`; the product never does.
 * ctx: {call, reload, data, finish(workspaceId), signInHref?():string, fixtureAuth?(helpers), demo?:{email,password}} */
export function createFirstRun(ctx) {
  const t = (key, values = []) => tr('flow.firstRun.' + key, values)
  const busy = signal(false),
    errors = signal(/** @type {Record<string,string>} */ ({})),
    step = signal(''),
    revision = signal(0)
  const created = { workspaceId: '', workspaceTitle: '', projectId: '' }
  const invitationKeys = new Map()
  const workspace = { title: '', key: '' },
    project = { title: '', code: '', codeTouched: false, defaultView: 'board', plan: 'sprint', key: '' },
    invite = { emails: '', role: 'member' }
  const redraw = () => revision.set(revision() + 1)
  const focusInvalid = (/** @type {HTMLFormElement|null} */ form) =>
    queueMicrotask(() => form?.querySelector('[aria-invalid="true"]')?.focus())
  /** Runs one request; field errors land next to their field, anything else above the actions. */
  const run = async (
    /** @type {()=>Promise<void>} */ work,
    /** @type {Record<string,string>} */ codes = {},
    /** @type {HTMLFormElement|null} */ form = null,
  ) => {
    if (busy()) return
    busy.set(true)
    errors.set({})
    try {
      await work()
    } catch (/** @type {any} */ e) {
      const fields = e.fields ?? {}
      errors.set(
        codes[e.code]
          ? { [codes[e.code]]: t('error.' + e.code) }
          : Object.keys(fields).length
            ? fields
            : { form: e.message },
      )
    } finally {
      busy.set(false)
      if (Object.keys(errors()).some((key) => key !== 'form')) focusInvalid(form)
    }
  }
  const formError = () => (errors().form ? FlowHint({ tone: 'red', children: errors().form }) : null)
  const submit = (/** @type {string} */ label) =>
    FlowButton({ label, variant: 'primary', type: 'submit', loading: busy() })
  const brand = () => (ctx.data()?.company?.name ? `Flow · ${ctx.data().company.name}` : 'Flow')

  /** Onboarding runs while the organization has no workspace, and keeps running through its own steps after the first one creates it. */
  const needed = () => {
    const d = ctx.data()
    return (
      Boolean(d) &&
      (step() !== '' || (d.workspaces?.length === 0 && d.capabilities?.manageOrganization === true))
    )
  }
  const current = () => step() || 'workspace'
  const intents = new Map()
  const invoke = async (name, args, key) => {
    const held = intents.get(key) ?? { ...args, idempotencyKey: key }
    intents.set(key, held)
    try {
      const value = await ctx.call(name, held)
      intents.delete(key)
      return value
    } catch (error) {
      if (['conflict', 'validation'].includes(error.code)) intents.delete(key)
      throw error
    }
  }
  const organizationCommand = (/** @type {Record<string,unknown>} */ args, /** @type {string} */ key) =>
    invoke(
      'flow.organization.command',
      {
        ...args,
        idempotencyKey: key,
        expectedRevision: ctx.data().organizationRevision,
      },
      key,
    )

  const workspaceStep = () => ({
    title: t('workspace.title'),
    description: t('workspace.description'),
    onSubmit: (/** @type {Event} */ e) => {
      e.preventDefault()
      if (!workspace.title.trim()) {
        errors.set({ title: t('required') })
        focusInvalid(/** @type {HTMLFormElement} */ (e.currentTarget))
        return
      }
      workspace.key ||= crypto.randomUUID()
      void run(
        async () => {
          const value = await organizationCommand(
            { action: 'workspace.save', title: workspace.title.trim(), description: '', access: 'internal' },
            workspace.key,
          )
          Object.assign(created, { workspaceId: value.id, workspaceTitle: workspace.title.trim() })
          workspace.key = ''
          step.set('project')
          await ctx.reload()
        },
        {},
        /** @type {HTMLFormElement} */ (e.currentTarget),
      )
    },
    children: html`${FlowInput({
      id: 'workspace-title',
      label: t('workspace.name'),
      placeholder: t('workspace.placeholder'),
      required: true,
      value: workspace.title,
      error: errors().title,
      onInput: (e) => {
        workspace.title = /** @type {HTMLInputElement} */ (e.target).value
      },
    })}${FlowHint({ children: t('workspace.access', [ctx.data().company.name]) })}${formError()}`,
    actions: submit(t('continue')),
  })

  const projectStep = () => ({
    title: t('project.title'),
    description: t('project.description', [created.workspaceTitle]),
    onSubmit: (/** @type {Event} */ e) => {
      e.preventDefault()
      const invalid = !project.title.trim()
        ? { title: t('required') }
        : !PROJECT_CODE.test(project.code)
          ? { code: t('project.codeInvalid') }
          : null
      if (invalid) {
        errors.set(invalid)
        focusInvalid(/** @type {HTMLFormElement} */ (e.currentTarget))
        return
      }
      project.key ||= crypto.randomUUID()
      void run(
        async () => {
          const value = await invoke(
            'flow.entity.save',
            {
              collection: 'projects',
              workspaceId: created.workspaceId,
              title: project.title.trim(),
              code: project.code,
              description: '',
              access: 'workspace',
              ownerId: ctx.data().user.id,
              defaultView: project.defaultView,
              sprintCadence: project.plan === 'sprint' ? { ...DEFAULT_CADENCE } : null,
              state: 'planned',
              tags: [],
              memberIds: [],
              teamIds: [],
              expectedRevision: ctx.data().organizationRevision,
              idempotencyKey: project.key,
            },
            project.key,
          )
          created.projectId = value.id
          project.key = ''
          step.set('invite')
          await ctx.reload()
        },
        {},
        /** @type {HTMLFormElement} */ (e.currentTarget),
      )
    },
    children: html`${FlowInput({
      id: 'project-title',
      label: t('project.name'),
      placeholder: t('project.placeholder'),
      required: true,
      value: project.title,
      error: errors().title,
      onInput: (e) => {
        project.title = /** @type {HTMLInputElement} */ (e.target).value
        if (!project.codeTouched) {
          project.code = projectCode(project.title)
          redraw()
        }
      },
    })}${FlowInput({
      id: 'project-code',
      label: t('project.code'),
      placeholder: 'WEB',
      required: true,
      value: project.code,
      error: errors().code,
      onInput: (e) => {
        project.code = /** @type {HTMLInputElement} */ (e.target).value.toUpperCase()
        project.codeTouched = true
        redraw()
      },
    })}${errors().code ? null : FlowHint({ children: t('project.codeHint', [project.code || 'WEB']) })}${FlowSelectField(
      {
        name: 'project-view',
        label: t('project.view'),
        value: project.defaultView,
        options: [
          { value: 'board', label: tr('flow.ui.task.board') },
          { value: 'project-issues', label: tr('flow.ui.task.list') },
        ],
        onChange: (e) => {
          project.defaultView = /** @type {HTMLSelectElement} */ (e.target).value
        },
      },
    )}${FlowSelectField({
      name: 'project-plan',
      label: t('project.plan'),
      value: project.plan,
      options: [
        { value: 'sprint', label: t('project.sprint') },
        { value: 'kanban', label: t('project.kanban') },
      ],
      onChange: (e) => {
        project.plan = /** @type {HTMLSelectElement} */ (e.target).value
      },
    })}${FlowHint({ children: t('project.planHint') })}${formError()}`,
    actions: submit(t('project.submit')),
  })

  const finish = async () => {
    const id = created.workspaceId
    step.set('')
    await ctx.finish(id)
  }
  const inviteStep = () => ({
    title: t('invite.title'),
    description: t('invite.description'),
    onSubmit: (/** @type {Event} */ e) => {
      e.preventDefault()
      const { emails, invalid } = parseInvites(invite.emails)
      if (invalid.length) {
        errors.set({ emails: t('invite.invalid', [invalid.join(', ')]) })
        focusInvalid(/** @type {HTMLFormElement} */ (e.currentTarget))
        return
      }
      if (!emails.length) {
        errors.set({ emails: t('invite.none') })
        focusInvalid(/** @type {HTMLFormElement} */ (e.currentTarget))
        return
      }
      const role = invite.role
      void run(
        async () => {
          const sent = []
          try {
            for (const email of emails) {
              const signature = JSON.stringify([email, role])
              let key = invitationKeys.get(signature)
              if (!key) {
                key = crypto.randomUUID()
                invitationKeys.set(signature, key)
              }
              await organizationCommand({ action: 'member.invite', email, role }, key)
              invitationKeys.delete(signature)
              sent.push(email)
              await ctx.reload()
            }
          } catch (/** @type {any} */ error) {
            invite.emails = emails.filter((x) => !sent.includes(x)).join('\n')
            await ctx.reload()
            throw Object.assign(error, { fields: { emails: `${emails[sent.length]}: ${error.message}` } })
          }
          await finish()
        },
        {},
        /** @type {HTMLFormElement} */ (e.currentTarget),
      )
    },
    children: html`${FlowTextarea({
      id: 'invite-emails',
      label: t('invite.emails'),
      placeholder: t('invite.placeholder'),
      value: invite.emails,
      error: errors().emails,
      onInput: (e) => {
        invite.emails = /** @type {HTMLTextAreaElement} */ (e.target).value
      },
    })}${errors().emails ? null : FlowHint({ children: t('invite.hint') })}${FlowSelectField({
      name: 'invite-role',
      label: t('invite.role'),
      value: invite.role,
      options: [
        { value: 'member', label: t('invite.member') },
        { value: 'admin', label: t('invite.admin') },
      ],
      onChange: (e) => {
        invite.role = /** @type {HTMLSelectElement} */ (e.target).value
      },
    })}${formError()}`,
    actions: html`${FlowButton({ label: t('invite.skip'), variant: 'ghost', disabled: busy(), onClick: () => void run(finish) })}${submit(t('invite.submit'))}`,
  })

  const fixture = ctx.fixtureAuth?.({
    t,
    call: ctx.call,
    reload: ctx.reload,
    demo: ctx.demo,
    run,
    errors,
    focusInvalid,
    formError,
    submit,
    brand,
    revision,
  })

  /** The deployment owns sign-in; Flow only sends people back to it and is reopened afterwards. */
  const sessionPage = () =>
    FlowEntryPage({
      embedded: true,
      brand: brand(),
      title: t('session.title'),
      description: t('session.description'),
      // A full page load: the login page is the deployment's, not a Flow fragment.
      actions: html`<a data-flow="button" data-variant="primary" data-size="md" data-ket-reload href=${(ctx.signInHref ?? sharedSignIn)()}>${t('session.submit')}</a>`,
    })

  const onboardingPage = () => {
    revision()
    const key = current(),
      at = onboardingSteps.indexOf(key)
    const page = key === 'workspace' ? workspaceStep() : key === 'project' ? projectStep() : inviteStep()
    return FlowEntryPage({
      embedded: true,
      brand: brand(),
      stepsLabel: t('steps'),
      steps: onboardingSteps.map((id, i) => ({
        id,
        label: t(id + '.step'),
        complete: i < at,
        current: i === at,
      })),
      ...page,
    })
  }

  return {
    /** Which first-run page a failed or empty bootstrap needs, or null when the normal app should render. */
    page(/** @type {{code?:string}|null} */ failure) {
      if (!ctx.data())
        return failure?.code === 'unauthenticated'
          ? (fixture?.signInPage() ?? sessionPage())
          : failure?.code === 'password_change'
            ? (fixture?.passwordPage() ?? null)
            : null
      return needed() ? onboardingPage() : null
    },
    step: current,
  }
}
