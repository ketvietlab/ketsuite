#!/usr/bin/env node
/**
 * `ketspec build <openapi.json> --out <directory> [--lang en|vi] [--theme light|dark]`
 *
 * Writes a self-contained static Spec site: `index.html` with the document
 * embedded, the browser bundle, the stylesheets and the logos. Any static file
 * server can host the directory; the application keeps its location in the
 * query string, so no rewrite rules are needed.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SPEC_LOCALES } from './messages.ts'
import { readSpec } from './model.ts'
import { renderSpecPage } from './page.ts'

const usage = `Usage: ketspec build <openapi.json> --out <directory> [--lang ${SPEC_LOCALES.join('|')}] [--theme light|dark]`

const fail = (message: string): never => {
  process.stderr.write(`ketspec: ${message}\n${usage}\n`)
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))

const parse = (argv: readonly string[]) => {
  const [command, input, ...rest] = argv
  if (command !== 'build' || !input) fail('expected the build command and an OpenAPI file')
  const options: Record<string, string> = {}
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index]
    const value = rest[index + 1]
    if (!['--out', '--lang', '--theme'].includes(flag) || value === undefined)
      fail(`unknown or incomplete option ${flag}`)
    options[flag.slice(2)] = value
  }
  if (!options.out) fail('--out is required')
  if (options.lang && !(SPEC_LOCALES as readonly string[]).includes(options.lang))
    fail(`unsupported language ${options.lang}`)
  if (options.theme && options.theme !== 'light' && options.theme !== 'dark')
    fail(`unsupported theme ${options.theme}`)
  return {
    input: resolve(input),
    out: resolve(options.out),
    lang: options.lang,
    theme: options.theme as 'light' | 'dark' | undefined,
  }
}

const build = () => {
  const options = parse(process.argv.slice(2))
  let document: unknown
  try {
    document = JSON.parse(readFileSync(options.input, 'utf8'))
  } catch (error) {
    return fail(`cannot read ${options.input}: ${(error as Error).message}`)
  }
  const result = readSpec(document)
  if (!result.ok) return fail(`${options.input} is not an OpenAPI 3 document (${result.problem.detail})`)

  const bundle = join(here, 'browser/ketspec.mjs')
  if (!existsSync(bundle)) fail('the browser bundle is missing; build the package first')
  const designSystemStyles = fileURLToPath(import.meta.resolve('@ketvietlab/design-system/styles.css'))

  const assets = join(options.out, 'assets')
  mkdirSync(assets, { recursive: true })
  copyFileSync(bundle, join(assets, 'ketspec.mjs'))
  copyFileSync(designSystemStyles, join(assets, 'design-system.css'))
  copyFileSync(join(here, 'styles.css'), join(assets, 'ketspec.css'))
  for (const name of ['logo-light.svg', 'logo-dark.svg', 'mark.svg']) {
    copyFileSync(join(here, 'assets', name), join(assets, name))
  }
  writeFileSync(
    join(options.out, 'index.html'),
    renderSpecPage({
      document,
      locale: options.lang,
      theme: options.theme,
      assets: {
        script: 'assets/ketspec.mjs',
        designSystemStyles: 'assets/design-system.css',
        styles: 'assets/ketspec.css',
        logo: 'assets/logo-light.svg',
        logoDark: 'assets/logo-dark.svg',
        favicon: 'assets/mark.svg',
      },
    }),
  )
  process.stdout.write(
    `ketspec: wrote ${result.model.operations.length} operations to ${join(options.out, 'index.html')}\n`,
  )
}

build()
