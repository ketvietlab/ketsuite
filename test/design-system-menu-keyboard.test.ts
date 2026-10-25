import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(
  process.env.KET_MENU_MUTATION_SOURCE || 'packages/design-system/src/runtime/index.js',
  'utf8',
)
const handler = source.slice(source.indexOf('const activeMenu ='), source.indexOf('const openPopup ='))

function fixture(disabled = false) {
  const document: { activeElement: Element | null } = { activeElement: null }
  class Element {
    hidden = false
    disabled = false
    getAttribute(key: string) {
      return key === 'aria-disabled' && this.disabled ? 'true' : null
    }
    focus() {
      document.activeElement = this
    }
    closest(selector: string) {
      return selector.includes('[open]') && !menu.open ? null : menu
    }
    checkVisibility() {
      return !this.hidden
    }
  }
  class Details extends Element {
    open = !disabled
    querySelector() {
      return trigger
    }
    querySelectorAll() {
      return choices
    }
  }
  const menu = new Details()
  const trigger = new Element()
  trigger.disabled = disabled
  const query = new Element()
  const hidden = new Element()
  hidden.hidden = true
  const readonly = new Element()
  readonly.disabled = true
  const vip = new Element()
  const create = new Element()
  const choices = [hidden, readonly, vip, create]
  document.activeElement = disabled ? trigger : query
  let prevented = false
  const press = (key: string) => {
    prevented = false
    runInNewContext(`(function(event) { ${handler} })(event)`, {
      document,
      HTMLElement: Element,
      HTMLDetailsElement: Details,
      event: {
        key,
        preventDefault: () => {
          prevented = true
        },
      },
    })
  }
  return { menu, document, vip, create, trigger, press, prevented: () => prevented }
}

test('menu keyboard navigation skips filtered and disabled choices from the search input', () => {
  const app = fixture()
  app.press('ArrowDown')
  assert.equal(app.document.activeElement, app.vip)
  app.press('End')
  assert.equal(app.document.activeElement, app.create)
  app.press('Escape')
  assert.equal(app.menu.open, false)
  assert.equal(app.document.activeElement, app.trigger)
})

test('a disabled menu trigger blocks activation and leaves Tab navigation available', () => {
  const app = fixture(true)
  app.press('ArrowDown')
  assert.equal(app.menu.open, false)
  assert.equal(app.prevented(), true)
  app.press('Tab')
  assert.equal(app.prevented(), false)
})
