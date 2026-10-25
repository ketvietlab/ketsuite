import { createWebsiteStudio, type Call } from '@ketvietlab/website-client'
import type { AppSwitcherProps } from '@ketvietlab/design-system'
import { WebsiteStudioDocument } from '../../../../ui/website-public.ts'

/** The native transport keeps the request identity, company scope and function grants. */
export async function WebsiteStudioScreen(
  url: URL,
  transport: (name: string, input: Record<string, unknown>) => ReturnType<Call>,
  applications?: AppSwitcherProps,
) {
  const props = {
    path: url.pathname.replace(/^\/website\/?/, '') || 'overview',
    basePath: '/website/',
    query: Object.fromEntries(url.searchParams),
    applications,
  }
  const studio = createWebsiteStudio(props, {
    call: async <T,>(name: string, input: object = {}) =>
      (await transport(name, input as Record<string, unknown>)) as T,
  })
  try {
    const frame = await studio.serverFrame()
    return (
      <WebsiteStudioDocument
        props={JSON.stringify({ ...props, bootstrap: frame.bootstrap, frameFallback: frame.fallback })}
        frame={frame.view}
      />
    )
  } finally {
    studio.dispose()
  }
}
