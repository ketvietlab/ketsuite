# Website Studio client

Public MIT Website Studio components and server extension contracts for KetSuite.

Import the client from `@ketvietlab/website-client`, the stylesheet from
`@ketvietlab/website-client/styles.css`, and the server extension registry from
`@ketvietlab/website-client/server`. Browser mounting belongs in a disposable
client runtime. The public entry can be imported without a browser.

The native host calls `createWebsiteStudio(props, { call }).serverFrame()` with its
authorized request transport and embeds the returned view and bootstrap. Page
patterns and identity are server-owned. The browser entry uses the public island
manager to hydrate data slots only. Route/record/site changes fetch a fresh SSR
frame; query-only reads preserve the frame and draft inputs. Disposal aborts reads,
navigation, identity refreshes and uploads. The legacy catalogue-template address
redirects to the standard Builder on both direct entry and fragment navigation.

Appearance uses the public `ImageDropZone` in a compact 10rem logo composition.
The native host uploads against `website.Site` through its existing image endpoint;
the staged URL stays in the form until revision-checked style saving claims it.
Failed uploads retain the previous logo; removal changes only the draft.

Route-local Help is rendered on the server with public `HelpDrawer` and
`MarkdownContent`. The host supplies the lexer, native dialog focus is disposable,
and product recipes include Vietnamese and English instructions. This Studio's
existing UI locale remains Vietnamese.

See [CONTRACT.md](CONTRACT.md), [API-CONTRACT.md](API-CONTRACT.md) and
[EXTENSIONS.md](EXTENSIONS.md) for the integration boundaries.
