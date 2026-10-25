import { marked } from 'marked'
import { MarkdownContent } from '@ketvietlab/design-system'

export const HelpThemePreview = () => (
  <MarkdownContent
    lexer={marked.lexer}
    labels={{
      table: 'Reference table',
      diagram: 'Diagram',
      source: 'View source',
      loading: 'Rendering…',
      error: 'Diagram unavailable; inspect its source below.',
    }}
    source={`
# Ecosystem Mermaid theme
Each diagram uses resolved Két tokens, Inter and the same stroke hierarchy.

## Flowchart
\`\`\`mermaid
flowchart TD
 A([Request]) --> B[Check order]
 B --> C("Stock available?"):::kv-decision
 C -->|Yes| D[Reserve inventory]
 C -->|No| E[Contact customer]:::kv-warning
 D --> F([Complete]):::kv-positive
 E --> G([Cancelled]):::kv-danger
\`\`\`

## Sequence
\`\`\`mermaid
sequenceDiagram
 actor User
 participant App
 User->>App: Open help
 Note right of App: Screen context
 App-->>User: Show guide
\`\`\`

## State
\`\`\`mermaid
stateDiagram-v2
 [*] --> Draft
 Draft --> Confirmed
 Confirmed --> Completed
 Completed --> [*]
\`\`\`

## Entity relationship
\`\`\`mermaid
erDiagram
 CUSTOMER ||--o{ ORDER : places
 CUSTOMER { string name }
 ORDER { string number }
\`\`\`

## Pie
\`\`\`mermaid
pie title Order status
 "Draft" : 4
 "Complete" : 6
 "Review" : 2
\`\`\`

## Invalid source fallback
\`\`\`mermaid
not-a-valid-diagram
\`\`\`
`}
  />
)
