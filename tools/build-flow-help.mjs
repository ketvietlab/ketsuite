import { writeFileSync } from 'node:fs'
import { marked } from 'marked'
import { flowHelpContent } from '../packages/flow-client/client/help-content.mjs'

/** @type {Array<'vi' | 'en'>} */
const languages = ['vi', 'en']

export function buildFlowHelp() {
  const entries = Object.fromEntries(
    Object.entries(flowHelpContent).map(([key, guide]) => [
      key,
      {
        routes: guide.routes,
        ...Object.fromEntries(
          languages.map((lang) => [lang, { source: guide[lang], tokens: marked.lexer(guide[lang]) }]),
        ),
      },
    ]),
  )
  writeFileSync(
    new URL('../packages/flow-client/client/help-routes.generated.mjs', import.meta.url),
    '// Generated help route index; content is loaded on demand.\nexport const flowHelpRoutes = ' +
      JSON.stringify(Object.values(flowHelpContent).flatMap((guide) => guide.routes)) +
      '\n',
  )
  writeFileSync(
    new URL('../packages/flow-client/client/help.generated.mjs', import.meta.url),
    '// Generated from help-content.mjs by build-flow-help.mjs; do not edit.\nexport const flowHelp = ' +
      JSON.stringify(entries) +
      '\n',
  )
}
