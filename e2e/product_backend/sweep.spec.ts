import type { Page } from '@playwright/test'
import { DESKTOP, MOBILE, expect, listReady, settled, signIn, test } from './support.js'

// Every screen and dialog of the product module, for each kind of person, in each language and on
// each width, read the way a person would: nothing showing an error, a refusal they did not ask for, a
// message key or an unformatted value, and nothing wider than the screen. The other specs say what the
// screens do; this one says none of them shows a person something broken on the way.

type Role = 'admin' | 'viewer'
type Screen = {
  path: string
  /** Who has this screen: a dialog the viewer may not use is visited as `refused` instead. */
  for?: Role[]
  /** What the screen is once it is ready, so a wrong address fails rather than checking nothing. */
  shows: 'list' | 'page' | 'dialog' | 'refused'
  /** What tells this state from the plain screen, where the address alone would not. */
  holds?: string
}

const T = '/admin/product/templates'
const SCREENS: Screen[] = [
  { path: T, shows: 'list' },
  { path: `${T}?view=kanban`, shows: 'list', holds: '[data-product-list="true"] [data-ui="content-card"]' },
  {
    path: `${T}?group=categoryId`,
    shows: 'list',
    holds: '[data-product-list="true"] [data-ui="kt-group-row"]',
  },
  { path: `${T}?modal=favorite`, shows: 'dialog', for: ['admin'] },
  { path: `${T}/serum`, shows: 'page' },
  { path: `${T}/cream`, shows: 'page' },
  { path: `${T}/old-mask`, shows: 'page' },
  { path: `${T}/new`, shows: 'page', for: ['admin'] },
  { path: `${T}/serum?dialog=duplicate`, shows: 'dialog', for: ['admin'] },
  { path: `${T}/serum?dialog=archive`, shows: 'dialog', for: ['admin'] },
  { path: `${T}/serum?dialog=addImage`, shows: 'dialog', for: ['admin'] },
  { path: `${T}/serum?dialog=removeImage&dialogId=serum-box`, shows: 'dialog', for: ['admin'] },
  { path: `${T}/old-mask?dialog=restore`, shows: 'dialog', for: ['admin'] },
  { path: `${T}/cream?dialog=configureAttributes`, shows: 'dialog', for: ['admin'] },
  { path: `${T}/cream?dialog=editVariant&dialogId=cream:capacity-30ml`, shows: 'dialog', for: ['admin'] },
  // A dialog address the viewer may not use (a link someone sent them) says so, and runs nothing.
  { path: `${T}/serum?dialog=archive`, shows: 'refused', for: ['viewer'] },
  { path: `${T}/serum?dialog=addImage`, shows: 'refused', for: ['viewer'] },
  { path: `${T}/serum?tab=media`, shows: 'page' },
  { path: `${T}/cream/variants/cream:capacity-30ml`, shows: 'page' },
  { path: `${T}/cream/variants/cream:capacity-30ml?tab=media`, shows: 'page' },
  { path: '/admin/product/attributes', shows: 'page' },
  { path: '/admin/product/attributes?record=product.attribute:capacity', shows: 'dialog' },
  { path: '/admin/product/attributes?record=product.attribute:new', shows: 'dialog', for: ['admin'] },
  { path: '/admin/product/uoms', shows: 'page' },
  { path: '/admin/product/uoms?status=archived', shows: 'page' },
  { path: '/admin/product/uoms?record=product.uom:box-6', shows: 'dialog' },
  { path: '/admin/product/uoms?record=product.uom:new', shows: 'dialog', for: ['admin'] },
]

const withLang = (path: string, lang: string) => `${path}${path.includes('?') ? '&' : '?'}lang=${lang}`

/** What a dialog the viewer may not use says in place of its form (workspace-messages.ts `ws.denied`). */
const REFUSED = {
  vi: 'Vai trò hiện tại không được thực hiện thao tác này.',
  en: 'Your role cannot perform this action.',
}

const ready = async (page: Page, screen: Screen, lang: 'vi' | 'en') => {
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  if (screen.shows === 'list') await listReady(page)
  if (screen.holds) await expect(page.locator(screen.holds).first()).toBeVisible()
  if (screen.shows === 'dialog') await expect(page.getByRole('dialog').first()).toBeVisible()
  await settled(page)
  if (screen.shows === 'refused') {
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(lang === 'en' ? REFUSED.en : REFUSED.vi)
    // Only a way out stays enabled: the action itself is there, disabled, under the reason.
    const offered = await dialog
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons
          .filter((button) => !(button as HTMLButtonElement).disabled)
          .map((button) => button.getAttribute('aria-label') ?? (button.textContent ?? '').trim()),
      )
    expect(offered.filter((name) => !/^(Hủy|Cancel|Đóng|Close)$/u.test(name))).toEqual([])
  }
}

for (const role of ['admin', 'viewer'] as const)
  for (const lang of ['vi', 'en'] as const)
    for (const [width, viewport] of [
      ['desktop', DESKTOP],
      ['phone', MOBILE],
    ] as const)
      test.describe(`${role}, ${lang}, ${width}`, () => {
        test.use({ viewport })

        test(`@sweep every product screen and dialog reads without an error`, async ({ page, ui }) => {
          const screens = SCREENS.filter((screen) => !screen.for || screen.for.includes(role))
          const wide: string[] = []
          await signIn(page, role, withLang(screens[0]!.path, lang), lang)
          for (const screen of screens) {
            const path = withLang(screen.path, lang)
            await page.goto(path)
            await ready(page, screen, lang)
            await ui.check(path)
            const { scroll, client } = await page.evaluate(() => ({
              scroll: document.documentElement.scrollWidth,
              client: document.documentElement.clientWidth,
            }))
            if (scroll > client) wide.push(`${path}: ${scroll}px in ${client}px`)
          }
          expect(wide, 'screens wider than the viewport').toEqual([])
        })
      })
