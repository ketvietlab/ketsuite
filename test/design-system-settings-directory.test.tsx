import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { AppShell, SettingsDirectory } from '../packages/design-system/src/index.ts'
import { filterSettingsDirectory } from '../packages/design-system/src/runtime/navigation-tools.js'

const directory = () =>
  SettingsDirectory({
    id: 'settings',
    label: 'Cấu hình',
    search: { label: 'Tìm cấu hình', emptyTitle: 'Không có', emptyMessage: 'Thử từ khác' },
    sections: [
      {
        id: 'business',
        title: 'Kinh doanh',
        modules: [
          {
            id: 'crm',
            label: 'CRM',
            icon: '<svg></svg>',
            links: [
              { id: 'people', label: 'Đội ngũ & phân công', href: '/crm/people', current: true },
              { id: 'tags', label: 'Nhãn hồ sơ', href: '/crm/tags' },
            ],
          },
          { id: 'locked', label: 'Không được phép', icon: '', links: [] },
        ],
      },
      {
        id: 'empty',
        title: 'Không có module',
        modules: [{ id: 'none', label: 'Trống', icon: '', links: [] }],
      },
    ],
  })

test('a settings directory names its sections and modules and drops what has no links', () => {
  const output = renderToString(directory()).replace(/<!--k\[?-->/gu, '')
  assert.match(
    output,
    /data-ui="settings-directory"[^>]*role="region"[^>]*|role="region"[^>]*data-ui="settings-directory"/,
  )
  assert.match(
    output,
    /<section[^>]*data-ui="settings-directory-section"[^>]*aria-labelledby="settings-business"/,
  )
  assert.match(output, /<h2[^>]*id="settings-business"[^>]*>Kinh doanh<\/h2>|<h2[^>]*>Kinh doanh<\/h2>/)
  assert.match(output, /<article[^>]*aria-labelledby="settings-business-crm"/)
  assert.match(output, /data-ui="settings-directory-module-mark" aria-hidden="true"/)
  assert.match(output, /href="\/crm\/people"[^>]*aria-current="page"/)
  assert.match(
    output,
    /data-ui="settings-directory-search-input"[^>]*type="search"[^>]*aria-label="Tìm cấu hình"/,
  )
  assert.match(output, /data-ui="settings-directory-empty" hidden/)
  // A module the viewer may not configure, and a section left without modules, are not drawn.
  assert.doesNotMatch(output, /Không được phép|Không có module/)
})

test('the rail gear can open the settings page as a link marked current', () => {
  const output = renderToString(
    AppShell({
      applications: {
        label: 'Apps',
        newTabLabel: 'New tab',
        activeId: 'sales',
        items: [],
        settings: { id: 'rail-settings', label: 'Cấu hình', href: '/settings', current: true },
      },
      sidebar: '',
      main: 'Work',
    }),
  ).replace(/<!--k\[?-->/gu, '')
  assert.match(
    output,
    /<a[^>]*data-ui="app-switcher-settings-link"[^>]*href="\/settings"[^>]*aria-label="Cấu hình"[^>]*aria-current="page"/,
  )
  assert.doesNotMatch(output, /data-ui="menu-trigger"/)
})

class Node {
  hidden = false
  children: Node[] = []
  parent: Node | null = null
  readonly kind: string
  readonly textContent: string
  constructor(kind: string, textContent = '') {
    this.kind = kind
    this.textContent = textContent
  }
  add(child: Node) {
    child.parent = this
    this.children.push(child)
    return child
  }
  all(): Node[] {
    return this.children.flatMap((child) => [child, ...child.all()])
  }
  querySelectorAll(selector: string): Node[] {
    return this.all().filter((node) => selector.includes(`"${node.kind}"`))
  }
  querySelector(selector: string): Node | null {
    return this.querySelectorAll(selector)[0] ?? null
  }
  closest(tag: string): Node | null {
    let node: Node | null = this
    while (node && node.kind !== tag) node = node.parent
    return node
  }
}

test('searching keeps matching links, whole matching modules and their sections, accent-insensitively', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement')
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: Node })
  try {
    const root = new Node('settings-directory')
    const section = (title: string) => root.add(new Node('settings-directory-section', title))
    const module = (parent: Node, title: string, links: string[]) => {
      const node = parent.add(new Node('settings-directory-module'))
      node.add(new Node('settings-directory-module-title', title))
      return links.map(
        (label) => node.add(new Node('li')).add(new Node('settings-directory-link', label)).parent as Node,
      )
    }
    const business = section('Kinh doanh')
    const [people, tags] = module(business, 'CRM', ['Đội ngũ & phân công', 'Nhãn hồ sơ'])
    const [requests] = module(business, 'Chăm sóc khách hàng', ['Yêu cầu & khiếu nại'])
    const access = section('Tổ chức')
    const [users, roles] = module(access, 'Người dùng', ['Người dùng', 'Vai trò chuẩn'])
    const empty = root.add(new Node('settings-directory-empty'))
    const directory = root as unknown as HTMLElement

    assert.equal(filterSettingsDirectory(directory, 'khieu nai'), 1)
    assert.deepEqual([people.hidden, tags.hidden, requests.hidden], [true, true, false])
    assert.equal(access.hidden, true)
    assert.equal(empty.hidden, true)

    // A matching module name keeps every link it holds.
    assert.equal(filterSettingsDirectory(directory, 'NGUOI DUNG'), 2)
    assert.deepEqual([users.hidden, roles.hidden, business.hidden], [false, false, true])

    assert.equal(filterSettingsDirectory(directory, 'không có'), 0)
    assert.equal(empty.hidden, false)

    assert.equal(filterSettingsDirectory(directory, ''), 5)
    assert.deepEqual([business.hidden, access.hidden, empty.hidden, tags.hidden], [false, false, true, false])
  } finally {
    if (previous) Object.defineProperty(globalThis, 'HTMLElement', previous)
    else delete (globalThis as { HTMLElement?: unknown }).HTMLElement
  }
})
