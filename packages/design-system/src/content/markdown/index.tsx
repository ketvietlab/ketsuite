import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'markdown',
  'markdown-table',
  'mermaid',
  'mermaid-status',
  'mermaid-canvas',
  'mermaid-source',
] as const

/** Structural lexer contract: a host can supply marked.lexer without coupling the DS to a parser. */
export type MarkdownToken = {
  type: string
  raw?: string
  text?: string
  tokens?: readonly MarkdownToken[]
  depth?: number
  lang?: string
  href?: string
  title?: string | null
  ordered?: boolean
  start?: number | ''
  task?: boolean
  checked?: boolean
  items?: readonly MarkdownToken[]
  header?: readonly MarkdownCell[]
  rows?: readonly (readonly MarkdownCell[])[]
  align?: readonly (string | null)[]
}
type MarkdownCell = { text: string; tokens?: readonly MarkdownToken[] }
export type MarkdownLabels = {
  diagram: string
  source: string
  loading: string
  error: string
  table: string
}
export type MarkdownContentProps = {
  source: string
  lexer: (source: string) => readonly MarkdownToken[]
  labels: MarkdownLabels
  /** Offset Markdown headings inside a named drawer or section. */
  headingOffset?: number
}

/** Relative and explicit web/mail destinations only; HTML is always rendered as text. */
export const safeMarkdownHref = (href = '', image = false): string | null => {
  const value = href.trim()
  if (
    !value ||
    [...value].some(
      (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === '\\',
    ) ||
    value.startsWith('//')
  )
    return null
  if (/^[a-z][a-z\d+.-]*:/iu.test(value))
    return (image ? /^https?:/iu : /^(?:https?|mailto):/iu).test(value) ? value : null
  return value
}

export const MermaidDiagram = (props: {
  source: string
  labels: Omit<MarkdownLabels, 'table'>
}): TemplateResult => (
  <figure
    data-ui="mermaid"
    data-state="source"
    data-error-label={props.labels.error}
    data-loading-label={props.labels.loading}
  >
    <figcaption>{props.labels.diagram}</figcaption>
    <p data-ui="mermaid-status" role="status" hidden>
      {props.labels.loading}
    </p>
    <div data-ui="mermaid-canvas" role="region" aria-label={props.labels.diagram} tabindex="0" hidden />
    <details data-ui="mermaid-source" open>
      <summary>{props.labels.source}</summary>
      <pre>
        <code>{props.source}</code>
      </pre>
    </details>
  </figure>
)

/** SSR Markdown with escaped HTML, safe links and Mermaid source fallback. */
export const MarkdownContent = (props: MarkdownContentProps): TemplateResult => {
  const render = (tokens: readonly MarkdownToken[]): JSXChild[] =>
    tokens.map((token) => {
      const children = token.tokens ? render(token.tokens) : (token.text ?? token.raw ?? '')
      switch (token.type) {
        case 'space':
          return null
        case 'heading': {
          const Tag = `h${Math.max(1, Math.min(6, (token.depth ?? 1) + (props.headingOffset ?? 0)))}` as
            | 'h1'
            | 'h2'
            | 'h3'
            | 'h4'
            | 'h5'
            | 'h6'
          return <Tag>{children}</Tag>
        }
        case 'paragraph':
          return <p>{children}</p>
        case 'text':
        case 'escape':
          return children
        case 'html':
          return token.raw ?? token.text ?? ''
        case 'strong':
          return <strong>{children}</strong>
        case 'em':
          return <em>{children}</em>
        case 'del':
          return <del>{children}</del>
        case 'codespan':
          return <code>{token.text}</code>
        case 'br':
          return <br />
        case 'hr':
          return <hr />
        case 'link': {
          const href = safeMarkdownHref(token.href)
          return href ? (
            <a href={href} title={token.title ?? undefined}>
              {children}
            </a>
          ) : (
            children
          )
        }
        case 'image': {
          const src = safeMarkdownHref(token.href, true)
          return src ? (
            <img src={src} alt={token.text ?? ''} title={token.title ?? undefined} loading="lazy" />
          ) : (
            (token.text ?? '')
          )
        }
        case 'code':
          return token.lang?.split(/\s/u)[0] === 'mermaid' ? (
            <MermaidDiagram source={token.text ?? ''} labels={props.labels} />
          ) : (
            <pre>
              <code>{token.text}</code>
            </pre>
          )
        case 'blockquote':
          return <blockquote>{children}</blockquote>
        case 'list': {
          const items = (token.items ?? []).map((item) => (
            <li>
              {item.task && (
                <input
                  type="checkbox"
                  checked={item.checked === true}
                  disabled
                  aria-label={item.text ?? ''}
                />
              )}
              {render(item.tokens ?? [])}
            </li>
          ))
          return token.ordered ? (
            <ol start={typeof token.start === 'number' ? token.start : 1}>{items}</ol>
          ) : (
            <ul>{items}</ul>
          )
        }
        case 'table':
          return (
            <div data-ui="markdown-table" role="region" aria-label={props.labels.table} tabindex="0">
              <table>
                <thead>
                  <tr>
                    {(token.header ?? []).map((cell, index) => (
                      <th scope="col" data-align={token.align?.[index] ?? undefined}>
                        {cell.tokens ? render(cell.tokens) : cell.text}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(token.rows ?? []).map((row) => (
                    <tr>
                      {row.map((cell, index) => (
                        <td data-align={token.align?.[index] ?? undefined}>
                          {cell.tokens ? render(cell.tokens) : cell.text}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        default:
          return token.raw ?? token.text ?? ''
      }
    })
  return <article data-ui="markdown">{render(props.lexer(props.source))}</article>
}
