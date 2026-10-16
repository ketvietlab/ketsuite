import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Icon, type IconName } from '../../primitives/icon/index.tsx'
import { Menu, type MenuEntry } from '../../interactions/menu/index.tsx'
import type { NavigationToolsProps } from '../app-navigation/index.tsx'
import { ModalSheet } from '../../patterns/modal-sheet/index.tsx'
import { pageIdentity, pageIdentityContent, type PageIdentityProps } from '../page-identity/index.tsx'

export const HOOKS = [
  'app-shell',
  'app-switcher',
  'app-switcher-brand',
  'app-switcher-expand',
  'app-switcher-list',
  'app-switcher-item',
  'app-switcher-tooltip',
  'app-switcher-footer',
  'app-switcher-help',
  'app-switcher-settings',
  'app-switcher-settings-link',
  'app-shell-topbar',
  'app-topbar',
  'app-location-bar',
  'app-location-context',
  'app-brand',
  'app-topbar-brand',
  'app-topbar-context',
  'global-search-trigger',
  'global-search-trigger-label',
  'global-search-shortcut',
  'global-search-dialog',
  'global-search',
  'global-search-input',
  'global-search-submit',
  'app-sidebar',
  'app-main',
  'app-right-rail',
  'page',
  'page-context',
  'page-header',
  'page-heading',
  'page-eyebrow',
  'page-title-row',
  'page-title',
  'page-subline',
  'page-status',
  'page-actions',
  'page-meta',
  'page-body',
  'record-canvas',
  'record-content',
  'record-section',
  'record-section-title',
] as const

export type AppSwitcherItem = {
  id: string
  label: string
  href?: string
  /** An app without a destination is informative and cannot be opened. */
  unavailableLabel?: string
  icon: IconName
}

export type AppSwitcherProps = {
  label: string
  newTabLabel: string
  brand?: { label: string; href: string; image: string; darkImage?: string }
  navigation?: { controls: string; label: string; tools?: NavigationToolsProps }
  helpLabel?: string
  /**
   * Settings beside Help: a menu of `items`, or, with `href`, a link to the
   * settings page that gathers every module's configuration. `current` marks
   * that page as open.
   */
  settings?:
    | { id: string; label: string; items: readonly MenuEntry[]; href?: never; current?: never }
    | { id: string; label: string; href: string; current?: boolean; items?: never }
  activeId: string
  items: readonly AppSwitcherItem[]
}

/** The same screen-owned HelpDrawer trigger for Suite rails and standalone app navigation. */
export const AppSwitcherHelp = (props: { label: string }): TemplateResult => (
  <button type="button" data-ui="app-switcher-help" aria-label={props.label}>
    <Icon name="circle-help" />
    <span data-ui="app-switcher-tooltip" aria-hidden="true">
      {props.label}
    </span>
  </button>
)

/** Persistent app navigation; destinations and translated names belong to the host. */
export const AppSwitcher = (props: AppSwitcherProps): TemplateResult => (
  <nav data-ui="app-switcher" aria-label={props.label}>
    {props.brand && (
      <div data-ui="app-switcher-brand">
        <AppBrand {...props.brand} variant="mark" />
      </div>
    )}
    {props.navigation && (
      <button
        type="button"
        data-ui="app-switcher-expand"
        aria-controls={props.navigation.controls}
        aria-label={props.navigation.label}
        aria-expanded="true"
      >
        <Icon name="chevron-right" />
        <span data-ui="app-switcher-tooltip" aria-hidden="true">
          {props.navigation.label}
        </span>
      </button>
    )}
    <div data-ui="app-switcher-list">
      {props.items.map((item) => (
        <a
          data-ui="app-switcher-item"
          data-app-id={item.id}
          data-active={item.id === props.activeId ? 'true' : null}
          aria-current={item.id === props.activeId ? 'page' : null}
          role={item.href ? undefined : 'link'}
          aria-disabled={item.href ? null : 'true'}
          tabindex={item.href ? null : '0'}
          aria-label={`${item.label} · ${item.href ? props.newTabLabel : (item.unavailableLabel ?? item.label)}`}
          title={item.label}
          href={item.href}
          target={item.href ? '_blank' : null}
          rel={item.href ? 'noopener noreferrer' : null}
        >
          <Icon name={item.icon} />
          <span data-ui="app-switcher-tooltip" aria-hidden="true">
            {item.href ? item.label : `${item.label} · ${item.unavailableLabel ?? item.label}`}
          </span>
        </a>
      ))}
    </div>
    <footer data-ui="app-switcher-footer">
      {props.helpLabel && <AppSwitcherHelp label={props.helpLabel} />}
      {props.settings?.href !== undefined && (
        <div data-ui="app-switcher-settings">
          <a
            data-ui="app-switcher-settings-link"
            id={props.settings.id}
            href={props.settings.href}
            aria-label={props.settings.label}
            aria-current={props.settings.current ? 'page' : null}
            data-active={props.settings.current ? 'true' : null}
          >
            <Icon name="settings" />
            <span data-ui="app-switcher-tooltip" aria-hidden="true">
              {props.settings.label}
            </span>
          </a>
        </div>
      )}
      {props.settings?.items !== undefined && (
        <div data-ui="app-switcher-settings">
          <Menu
            id={props.settings.id}
            label={props.settings.label}
            items={props.settings.items}
            placement="right"
            trigger={
              <>
                <Icon name="settings" />
                <span data-ui="app-switcher-tooltip" aria-hidden="true">
                  {props.settings.label}
                </span>
              </>
            }
          />
        </div>
      )}
    </footer>
  </nav>
)

export const AppShell = (props: {
  applications: AppSwitcherProps
  topbar?: JSXChild
  location?: JSXChild
  sidebar: JSXChild
  main: JSXChild
  rightRail?: JSXChild
  mode?: 'viewport' | 'embedded'
}): TemplateResult => (
  <div
    data-ui="app-shell"
    data-has-right-rail={String(props.rightRail !== undefined)}
    data-has-location={props.location !== undefined ? 'true' : null}
    data-has-topbar={props.topbar !== undefined ? 'true' : null}
    data-mode={props.mode ?? 'viewport'}
  >
    <AppSwitcher {...props.applications} />
    {props.topbar !== undefined && <div data-ui="app-shell-topbar">{props.topbar}</div>}
    <aside data-ui="app-sidebar">{props.sidebar}</aside>
    {props.mode === 'embedded' ? (
      <div data-ui="app-main">
        {props.location}
        {props.main}
      </div>
    ) : (
      <main data-ui="app-main">
        {props.location}
        {props.main}
      </main>
    )}
    {props.rightRail !== undefined && <aside data-ui="app-right-rail">{props.rightRail}</aside>}
  </div>
)

const SearchIcon = (): TemplateResult => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    aria-hidden="true"
  >
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
)

export const AppBrand = (props: {
  label: string
  href: string
  image?: string
  darkImage?: string
  imageFit?: 'contain' | 'cover'
  /** Show the symbol at the start of a three-to-one brand lockup. */
  variant?: 'mark'
}): TemplateResult => (
  <a
    data-ui="app-brand"
    data-image-fit={props.imageFit}
    data-variant={props.variant}
    href={props.href}
    aria-label={props.label}
  >
    {props.image ? (
      <img src={props.image} alt={props.label} data-appearance={props.darkImage ? 'light' : undefined} />
    ) : (
      props.label
    )}
    {props.darkImage && <img src={props.darkImage} alt={props.label} data-appearance="dark" />}
  </a>
)

/** Application identity and a compact launcher for a native GET search dialog. */
export const AppTopbar = (props: {
  brand?: { label: string; href: string; image?: string }
  /** A location strip stays inside the main column, beside the sidebar identity. */
  location?: JSXChild
  navigation?: JSXChild
  context?: JSXChild
  tools?: JSXChild
  search: {
    /** A direct search workspace needs no native dialog/template or noscript copy. */
    mode?: 'dialog' | 'link'
    id?: string
    action: string
    label: string
    triggerLabel?: string
    closeLabel?: string
    placeholder: string
    submitLabel: string
    query?: string
    locale?: string
  }
}): TemplateResult => {
  const id = props.search.id ?? 'app-global-search'
  const href = `${props.search.action}${props.search.action.includes('?') ? '&' : '?'}${props.search.locale ? `lang=${encodeURIComponent(props.search.locale)}&` : ''}q=${encodeURIComponent(props.search.query ?? '')}`
  const form = (
    <form
      data-ui="global-search"
      role="search"
      aria-label={props.search.label}
      action={props.search.action}
      method="get"
    >
      {props.search.locale ? <input type="hidden" name="lang" value={props.search.locale} /> : null}
      <input
        data-ui="global-search-input"
        type="search"
        name="q"
        value={props.search.query ?? ''}
        placeholder={props.search.placeholder}
        aria-label={props.search.label}
        autocomplete="off"
        maxlength={200}
      />
      <button
        data-ui="global-search-submit"
        type="submit"
        aria-label={props.search.submitLabel}
        title={props.search.submitLabel}
      >
        <SearchIcon />
      </button>
    </form>
  )
  return (
    <>
      <header data-ui={props.location !== undefined ? 'app-location-bar' : 'app-topbar'}>
        {props.navigation}
        {props.brand && (
          <a data-ui="app-topbar-brand" href={props.brand.href} aria-label={props.brand.label}>
            {props.brand.image ? <img src={props.brand.image} alt={props.brand.label} /> : props.brand.label}
          </a>
        )}
        {props.location !== undefined && <div data-ui="app-location-context">{props.location}</div>}
        {props.context != null && <div data-ui="app-topbar-context">{props.context}</div>}
        <a
          data-ui="global-search-trigger"
          href={href}
          aria-label={props.search.label}
          aria-haspopup={props.search.mode === 'link' ? null : 'dialog'}
          aria-controls={props.search.mode === 'link' ? null : id}
          aria-expanded={props.search.mode === 'link' ? null : 'false'}
          title={props.search.label}
        >
          <SearchIcon />
          <span data-ui="global-search-trigger-label">{props.search.triggerLabel ?? props.search.label}</span>
          <kbd data-ui="global-search-shortcut" hidden>
            Ctrl K
          </kbd>
        </a>
        {props.tools}
      </header>
      {props.search.mode !== 'link' && (
        <dialog data-ui="global-search-dialog" id={id} aria-labelledby={`${id}-sheet-title`}>
          {form}
          <template>
            <ModalSheet
              id={`${id}-sheet`}
              title={props.search.label}
              closeLabel={props.search.closeLabel ?? 'Close'}
              mode="client"
              presentation="dialog"
              dialogSemantics="parent"
              body={null}
            />
          </template>
        </dialog>
      )}
      {props.search.mode !== 'link' && <noscript>{form}</noscript>}
    </>
  )
}

export type PageHeaderProps = Omit<PageIdentityProps, 'context' | 'description'>

export const PageHeader = (props: PageHeaderProps): TemplateResult => (
  <header data-ui="page-header" data-kv-page-identity="header">
    {pageIdentityContent('page', props)}
  </header>
)

export type PageProps = Omit<PageIdentityProps, 'description'> & {
  body: JSXChild
}

export const Page = (props: PageProps): TemplateResult => {
  const { body, ...identity } = props
  return (
    <section data-ui="page">
      {pageIdentity('page', identity)}
      <div data-ui="page-body">{body}</div>
    </section>
  )
}

export const RecordCanvas = (props: { body: JSXChild }): TemplateResult => (
  <div data-ui="record-canvas">
    <div data-ui="record-content">{props.body}</div>
  </div>
)

export const RecordSection = (props: { body: JSXChild; title?: string | null }): TemplateResult => (
  <section data-ui="record-section">
    {!!props.title && <h2 data-ui="record-section-title">{props.title}</h2>}
    {props.body}
  </section>
)
