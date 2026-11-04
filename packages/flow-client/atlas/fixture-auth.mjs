import { html } from '@ketvietlab/ketjs-view'
import { FlowInput } from '@ketvietlab/flow-ui'
import { FlowEntryPage, FlowHint } from '@ketvietlab/flow-ui/workspace'
import { PASSWORD_MIN } from '@ketvietlab/flow-client/first-run.mjs'

/** Atlas has no accounts: the blank organization signs in with its mock credential and replaces the issued password here.
 * The product never loads this; an expired product session links to the deployment login instead. */
export function createFixtureAuth({
  t,
  call,
  reload,
  demo,
  run,
  errors,
  focusInvalid,
  formError,
  submit,
  brand,
  revision,
}) {
  const signIn = { email: '', password: '' },
    secret = { password: '', confirm: '' }

  const signInPage = () => {
    revision()
    return FlowEntryPage({
      embedded: true,
      brand: brand(),
      title: t('signIn.title'),
      description: t('signIn.description'),
      onSubmit: (e) => {
        e.preventDefault()
        void run(
          async () => {
            await call('flow.auth.signIn', { email: signIn.email.trim(), password: signIn.password })
            signIn.password = ''
            await reload()
          },
          { credentials: 'password' },
          e.currentTarget,
        )
      },
      children: html`${FlowInput({
        id: 'sign-in-email',
        label: t('email'),
        type: 'email',
        autocomplete: 'username',
        required: true,
        value: signIn.email,
        onInput: (e) => {
          signIn.email = /** @type {HTMLInputElement} */ (e.target).value
        },
      })}${FlowInput({
        id: 'sign-in-password',
        label: t('password'),
        type: 'password',
        autocomplete: 'current-password',
        required: true,
        value: signIn.password,
        error: errors().password,
        onInput: (e) => {
          signIn.password = /** @type {HTMLInputElement} */ (e.target).value
        },
      })}${formError()}${demo ? FlowHint({ tone: 'yellow', children: t('signIn.demo', [demo.email, demo.password]) }) : null}`,
      actions: submit(t('signIn.submit')),
      footer: t('signIn.help'),
    })
  }

  const passwordPage = () => {
    revision()
    const check = () =>
      secret.password.length < PASSWORD_MIN
        ? { password: t('password.short', [PASSWORD_MIN]) }
        : secret.confirm !== secret.password
          ? { confirm: t('password.mismatch') }
          : null
    return FlowEntryPage({
      embedded: true,
      brand: brand(),
      title: t('password.title'),
      description: t('password.description', [PASSWORD_MIN]),
      onSubmit: (e) => {
        e.preventDefault()
        const invalid = check()
        if (invalid) {
          errors.set(invalid)
          focusInvalid(e.currentTarget)
          return
        }
        void run(
          async () => {
            await call('flow.auth.setPassword', { password: secret.password, confirm: secret.confirm })
            secret.password = secret.confirm = ''
            await reload()
          },
          {},
          e.currentTarget,
        )
      },
      children: html`${FlowInput({
        id: 'new-password',
        label: t('password.new'),
        type: 'password',
        autocomplete: 'new-password',
        required: true,
        value: secret.password,
        error: errors().password,
        onInput: (e) => {
          secret.password = /** @type {HTMLInputElement} */ (e.target).value
        },
      })}${FlowInput({
        id: 'confirm-password',
        label: t('password.confirm'),
        type: 'password',
        autocomplete: 'new-password',
        required: true,
        value: secret.confirm,
        error: errors().confirm,
        onInput: (e) => {
          secret.confirm = /** @type {HTMLInputElement} */ (e.target).value
        },
      })}${formError()}`,
      actions: submit(t('password.submit')),
    })
  }

  return { signInPage, passwordPage }
}
