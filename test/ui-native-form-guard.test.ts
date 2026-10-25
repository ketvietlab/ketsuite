import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  installNativeFormGuard,
  nativeFormValues,
} from '../packages/ketsuite/src/ui/client/native-form-guard.ts'

class Form extends EventTarget {
  dataset = { unsavedPrompt: 'Discard draft?', initialDraft: '' }
  elements = [
    { tagName: 'INPUT', name: 'productId', type: 'hidden', value: 'first' },
    { tagName: 'TEXTAREA', name: 'notes', type: 'textarea', value: 'Original' },
  ]
  closest() {
    return null
  }
}
class Anchor {
  target = ''
  href = 'http://local/other'
  closest() {
    return this
  }
  hasAttribute() {
    return false
  }
}
const dispatch = (target: EventTarget, type: string, origin: unknown) => {
  const event = new Event(type, { cancelable: true })
  Object.defineProperties(event, { target: { value: origin }, button: { value: 0 } })
  target.dispatchEvent(event)
  return event
}

test('native draft guard retains changed hidden relations across declined links/history and permits the form submit', async (t) => {
  const keys = [
    'window',
    'document',
    'Element',
    'location',
    'history',
    'MutationObserver',
    'confirm',
  ] as const
  const descriptors = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  const form = new Form(),
    forms = [form],
    window = new EventTarget(),
    document = Object.assign(new EventTarget(), { body: {}, querySelectorAll: () => forms })
  const location = { href: 'http://local/prepare' },
    history = {
      state: { original: true },
      pushState(state: unknown, _title: string, url: string) {
        this.state = state as typeof this.state
        location.href = url
      },
    }
  let accepted = false,
    prompts = 0,
    disconnected = false,
    rescan = () => {}
  const replacements = {
    window,
    document,
    Element: Anchor,
    location,
    history,
    MutationObserver: class {
      constructor(callback: () => void) {
        rescan = callback
      }
      observe() {}
      disconnect() {
        disconnected = true
      }
    },
    confirm: () => {
      prompts++
      return accepted
    },
  }
  for (const [key, value] of Object.entries(replacements))
    Object.defineProperty(globalThis, key, { value, configurable: true })
  const lifetime = new AbortController(),
    cleanup = installNativeFormGuard(document as unknown as Document, lifetime.signal)
  t.after(() => {
    lifetime.abort()
    cleanup()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  const anchor = new Anchor()
  assert.equal(dispatch(document, 'click', anchor).defaultPrevented, false)
  assert.equal(prompts, 0)
  location.href = 'http://local/prepare?stay=two'
  document.dispatchEvent(new Event('ket:navigation-complete'))
  form.elements[0]!.value = 'second'
  assert.equal(dispatch(document, 'click', anchor).defaultPrevented, true)
  assert.equal(form.elements[0]!.value, 'second')
  location.href = 'http://local/list'
  assert.equal(dispatch(document, 'ket:popstate', document).defaultPrevented, true)
  assert.equal(
    location.href,
    'http://local/prepare?stay=two',
    'restores the committed URL, not the URL before fragment insertion',
  )
  assert.equal(form.elements[0]!.value, 'second')
  assert.equal(dispatch(window, 'beforeunload', window).defaultPrevented, true)
  assert.equal(
    dispatch(document, 'submit', {}).defaultPrevented,
    true,
    'other forms cannot discard the draft',
  )
  const prior = prompts
  assert.equal(dispatch(document, 'submit', form).defaultPrevented, false)
  await Promise.resolve()
  assert.equal(prompts, prior, 'own valid submit does not ask to discard')
  assert.equal(dispatch(window, 'beforeunload', window).defaultPrevented, false)
  document.dispatchEvent(new Event('ket:navigation-error'))
  assert.equal(
    dispatch(window, 'beforeunload', window).defaultPrevented,
    true,
    'failed navigation restores guard',
  )
  form.elements[0]!.value = 'first'
  assert.equal(
    dispatch(document, 'click', anchor).defaultPrevented,
    false,
    'restoring original value is clean',
  )
  form.elements[1]!.value = 'Modified'
  accepted = true
  assert.equal(dispatch(document, 'click', anchor).defaultPrevented, false)
  assert.equal(
    dispatch(window, 'beforeunload', window).defaultPrevented,
    false,
    'accepted departure is not prompted twice',
  )
  const retained = new Form()
  retained.dataset.initialDraft = 'true'
  forms[0] = retained
  rescan()
  accepted = false
  assert.equal(
    dispatch(document, 'click', anchor).defaultPrevented,
    true,
    'server-retained refused values are already an unsaved draft',
  )
  lifetime.abort()
  cleanup()
  assert.equal(disconnected, true)
})

test('native draft values include canonical dates and selection changes, excluding unnamed presentation controls', () => {
  const form = new Form()
  const base = nativeFormValues(form as unknown as HTMLFormElement)
  form.elements.push({ tagName: 'INPUT', name: '', type: 'text', value: 'Formatted date' })
  assert.equal(nativeFormValues(form as unknown as HTMLFormElement), base)
  form.elements.push({ tagName: 'INPUT', name: 'serviceDate', type: 'hidden', value: '2026-10-14' })
  const before = nativeFormValues(form as unknown as HTMLFormElement)
  form.elements.at(-1)!.value = '2026-10-15'
  assert.notEqual(nativeFormValues(form as unknown as HTMLFormElement), before)
})
