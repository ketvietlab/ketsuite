import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Icon } from '../../primitives/icon/index.tsx'
import { EmptyState } from '../../primitives/feedback/index.tsx'

export const HOOKS = [
  'settings-directory',
  'settings-directory-search',
  'settings-directory-search-input',
  'settings-directory-section',
  'settings-directory-section-title',
  'settings-directory-grid',
  'settings-directory-module',
  'settings-directory-module-header',
  'settings-directory-module-mark',
  'settings-directory-module-title',
  'settings-directory-module-description',
  'settings-directory-links',
  'settings-directory-link',
  'settings-directory-empty',
] as const

export type SettingsDirectoryLink = {
  id: string
  label: string
  href: string
  /** Marks the setting this page was opened for. */
  current?: boolean
}

export type SettingsDirectoryModule = {
  id: string
  label: string
  /** The module's own mark, the icon its menu uses, supplied by the host. */
  icon: JSXChild
  description?: string
  links: readonly SettingsDirectoryLink[]
}

export type SettingsDirectorySection = {
  id: string
  title: string
  modules: readonly SettingsDirectoryModule[]
}

export type SettingsDirectoryProps = {
  id: string
  label: string
  /** Narrows the links already permitted on the page; nothing is fetched. */
  search?: {
    label: string
    placeholder?: string
    emptyTitle: string
    emptyMessage: string
  }
  sections: readonly SettingsDirectorySection[]
}

/**
 * Every configuration screen the viewer may open, grouped by module. The host
 * supplies only permitted modules and links; a module or section left without
 * links is not drawn, so a role never sees an empty heading.
 */
export const SettingsDirectory = (props: SettingsDirectoryProps): TemplateResult => {
  const sections = props.sections
    .map((section) => ({ ...section, modules: section.modules.filter((module) => module.links.length) }))
    .filter((section) => section.modules.length)
  return (
    <div data-ui="settings-directory" id={props.id} aria-label={props.label} role="region">
      {props.search && (
        <div data-ui="settings-directory-search" role="search">
          <Icon name="search" />
          <input
            data-ui="settings-directory-search-input"
            type="search"
            aria-label={props.search.label}
            aria-controls={props.id}
            placeholder={props.search.placeholder ?? props.search.label}
            autocomplete="off"
          />
        </div>
      )}
      {sections.map((section) => (
        <section
          data-ui="settings-directory-section"
          data-section-id={section.id}
          aria-labelledby={`${props.id}-${section.id}`}
        >
          <h2 data-ui="settings-directory-section-title" id={`${props.id}-${section.id}`}>
            {section.title}
          </h2>
          <div data-ui="settings-directory-grid">
            {section.modules.map((module) => (
              <article
                data-ui="settings-directory-module"
                data-module-id={module.id}
                aria-labelledby={`${props.id}-${section.id}-${module.id}`}
              >
                <header data-ui="settings-directory-module-header">
                  <span data-ui="settings-directory-module-mark" aria-hidden="true">
                    {module.icon}
                  </span>
                  <h3 data-ui="settings-directory-module-title" id={`${props.id}-${section.id}-${module.id}`}>
                    {module.label}
                  </h3>
                  {module.description && (
                    <p data-ui="settings-directory-module-description">{module.description}</p>
                  )}
                </header>
                <ul data-ui="settings-directory-links">
                  {module.links.map((link) => (
                    <li>
                      <a
                        data-ui="settings-directory-link"
                        href={link.href}
                        aria-current={link.current ? 'page' : null}
                      >
                        <span>{link.label}</span>
                        <Icon name="chevron-right" />
                      </a>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      ))}
      {props.search && (
        <div data-ui="settings-directory-empty" hidden>
          <EmptyState title={props.search.emptyTitle} message={props.search.emptyMessage} visual="search" />
        </div>
      )}
    </div>
  )
}
