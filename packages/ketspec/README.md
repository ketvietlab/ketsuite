# @ketvietlab/ketspec

**Spec** is an API reference and try-it console for OpenAPI 3.0 and 3.1
documents, rendered with the Két design system. It reads the documents KetJS
produces (`httpOpenApiDocument`) and any other OpenAPI 3 description, and shows
the same reference in English and Vietnamese, in light and dark themes, from a
phone to a wide desktop.

## A static site

```sh
npx ketspec build openapi.json --out site [--lang en|vi] [--theme light|dark]
```

`site/index.html` embeds the document and renders the overview before any
script runs; `site/assets/` holds the browser bundle, the two stylesheets and
the logos. Any static file server can host the directory, under any path: the
application keeps its place in the query string (`?operation=`, `?group=`,
`?q=`), so links are shareable and Back/Forward work without rewrite rules.

## Inside a server

```ts
import { renderSpecPage } from '@ketvietlab/ketspec'

const html = renderSpecPage({
  document,               // or specUrl: '/openapi.json' to fetch it in the browser
  url: request.url,       // selects the operation, group or search being rendered
  locale: 'vi',
  assets: {
    script: '/spec/ketspec.mjs',                    // @ketvietlab/ketspec/browser
    designSystemStyles: '/spec/design-system.css',  // @ketvietlab/design-system/styles.css
    styles: '/spec/ketspec.css',                    // @ketvietlab/ketspec/styles.css
    logo: '/spec/logo-light.svg',                   // @ketvietlab/ketspec/assets/logo-light.svg
    logoDark: '/spec/logo-dark.svg',
    favicon: '/spec/mark.svg',
  },
})
```

The browser bundle is self-contained: it carries its own copy of
`@ketvietlab/ketjs-view` and the design-system runtime, so it needs no
`/_ket/view/` route. `mountSpec` is exported for hosts that render their own
page around it.

## What it shows

- **Navigation.** Operations are grouped by their first tag, or by the first
  path segment when a document has no tags. Search matches method, path,
  operation id, summary and capability.
- **Operations.** Method, path, authentication, idempotency and the KetJS
  extensions; `x-ket-capability` (a key, or `{ key, action }`) reads as a
  Permission fact such as `crm.pipeline · assign`, and `x-ket-idempotent` as the
  idempotency fact, while other `x-` extensions are listed as they are; parameters
  by location; request and response schemas as a tree grid with types, formats,
  constraints, enums and `oneOf`/`anyOf` variants. Recursive schemas stop at the
  repeated reference instead of expanding forever.
- **Authentication.** The overview lists the declared schemes and, when there is
  more than one, says whether any one of them is accepted. An operation shows its
  `security` alternatives joined by "or" (`staffBearer or staffCookie or
  staffGateway`); schemes that one requirement combines are joined by "and".
- **Problems in the document.** Unresolved `$ref`s, duplicate operation ids and
  malformed operations are listed on the overview rather than hidden; a document
  that is not OpenAPI 3 shows what is wrong with it.

## Try it

Each operation has a form for its server, credentials, parameters and JSON
body, with a live `curl` preview.

- **Sign in** in the top bar (and on each console) opens a dialog with one
  field per credential the document declares: bearer token, basic credentials
  or API key. Saving fills every console; the console field only shows the
  credential and offers "Change credentials". Sign out forgets them. The dialog
  is modal: Enter saves, Escape or Cancel closes it, and focus returns to the
  button that opened it. Drafts in the console survive opening it.
- Credentials live in memory only. They are never written to the URL, storage
  or the curl preview, which shows `••••••` in their place. Cookie schemes send
  the browser's own cookies (`credentials: 'include'`).
- A mutating request warns before it is sent. An operation that declares an
  `Idempotency-Key` gets a generated key, regenerable, so a retry is safe.
- Missing required values, invalid JSON and malformed header values are
  reported on their fields before anything is sent.
- The answer shows status, duration, headers and body. The KetJS error envelope
  (`{ error: { code, message, requestId, fields } }`) is read into its message,
  per-field issues and request id.
- A request can be cancelled; it is abandoned after 30 seconds. Offline,
  network failures (including CORS refusals), timeouts and cancellation are
  told apart, and a cancelled or timed-out mutation is reported as possibly
  processed.

Calls go from the reader's browser straight to the API, so the API must allow
the page's origin (CORS) for anything but same-origin hosting.
