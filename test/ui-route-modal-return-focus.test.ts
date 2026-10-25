import assert from 'node:assert/strict'
import { test } from 'node:test'
import { restoreRouteModalOpener } from '../packages/ketsuite/src/ui/client/table-selection-view.tsx'

test('route modal return focus resolves the replaced opener without focusing a different or disabled link', () => {
  class Anchor {
    focused = false
    disabled = false
    inert = false
    readonly id: string
    readonly href: string
    constructor(id: string, href: string) {
      this.id = id
      this.href = href
    }
    closest() {
      return this.inert ? {} : null
    }
    getAttribute() {
      return this.disabled ? 'true' : null
    }
    focus() {
      this.focused = true
    }
  }
  const keys = ['document', 'location', 'HTMLAnchorElement'] as const
  const descriptors = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  const opener = {
    id: 'change',
    href: 'http://local/admin/hospitality/inventory?dialog=rules',
    pathname: '/admin/hospitality/inventory',
  }
  const wrong = new Anchor('change', 'http://local/admin/other')
  const replacement = new Anchor('', opener.href)
  try {
    Object.defineProperty(globalThis, 'HTMLAnchorElement', { configurable: true, value: Anchor })
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { pathname: opener.pathname },
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { getElementById: () => wrong, querySelectorAll: () => [wrong, replacement] },
    })
    assert.equal(restoreRouteModalOpener(opener), true)
    assert.equal(replacement.focused, true)
    assert.equal(wrong.focused, false)
    replacement.focused = false
    replacement.disabled = true
    assert.equal(restoreRouteModalOpener(opener), false)
    replacement.disabled = false
    replacement.inert = true
    assert.equal(restoreRouteModalOpener(opener), false)
    replacement.inert = false
    location.pathname = '/admin/hospitality/folios'
    assert.equal(restoreRouteModalOpener(opener), false)
    assert.equal(restoreRouteModalOpener(null), false)
    assert.equal(replacement.focused, false)
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
