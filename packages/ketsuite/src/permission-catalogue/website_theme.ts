import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['configure'],
  functions: {
    getThemeVersion: ['read', 'configure'],
    listThemes: ['read', 'configure'],
    selectTheme: ['configure', 'configure', 'website.configuration-audit'],
  },
  exemptions: {
    // Két Việt, or whoever runs a self-hosted server, installs and withdraws versions; no tenant role does.
    stageThemeVersion: ['internal-route', 'website_theme.operator-install'],
    completeThemeVersion: ['internal-route', 'website_theme.operator-install'],
    setThemeVersionStatus: ['internal-route', 'website_theme.operator-install'],
    // Only the /_theme file route; it serves available versions, which are public site assets.
    themeFileForReader: ['internal-route', 'website_theme.theme-file-route'],
  },
} satisfies CatalogueSource
