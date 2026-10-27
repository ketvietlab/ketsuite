# Flow core for KetSuite

`@ketvietlab/flow-client` is the MIT Flow client and extension boundary. It composes
`@ketvietlab/flow-ui` and uses only public KetJS/KetSuite dependencies. It has 76 core
routes. No private feature package, token, license server or telemetry is required.

Flow is delivered as a KetSuite deployment, not a separate framework or product
repository. A deployment composes the native `flow` module (`createFlowModule`) and the
`flow_workspace` island host with the shared identity, company, storage, mail and
`livedoc` modules; `production-entry.mjs` binds this client to that server. The older
`flow` + `flow_backend` backend remains for deployments that have not moved. Composing
the modules does not by itself accept a feature: `API-CONTRACT.md` records each
contract and what is still open.

## Package entry

```js
import { createFlowWorkspace } from '@ketvietlab/flow-client'
import { createFnClient } from '@ketvietlab/flow-client/api'
const workspace = createFlowWorkspace({ screen: 'my-work', basePath: '/flow/' }, {
  call: createFnClient(),
})
```

Register this factory with KetJS View's island manager; do not call `mount` manually
in a product. Load `@ketvietlab/design-system/tokens.css` and
`@ketvietlab/flow-ui/styles.css`. With `serverShell: true`, render
`shellView(dataIsland)` using authorized `flowShellData` chrome metadata. Sidebar,
header and routed tabs are SSR; only the data island starts with a deterministic
loading view. Client enhancement preserves those chrome nodes and native full-page
navigation receives the next SSR frame. See the executable Atlas server example.
A deployment provides authenticated, scoped HTTP functions. `API-CONTRACT.md` records
the proposed adapter and which APIs remain mock-only.

Private features register through [EXTENSIONS.md](EXTENSIONS.md). Missing extensions
have no routes or navigation. Core retains task completion, dependency checks, forms,
sprint reports, documents and the shared access model. Production authorization always
runs server-side, regardless of installed client extensions.

## Public checkout development

```sh
npm ci
npm run build
npm --workspace @ketvietlab/flow-client test
npm --workspace @ketvietlab/flow-client run atlas -- --port 4260
```

Open `http://127.0.0.1:4260/flow/my-work`. **Atlas uses in-memory synthetic data** and
keeps the same per-port fixture session across native navigation and reloads;
changing the explicit `state` starts another scenario. Sessions remain in memory
and reset when the server restarts or they expire. The development server and fixtures
are not included in the npm artifact. They must never be deployed as the product API.
No companion private checkout is needed to build, test or run this core demo.

`client/` retains the imported JavaScript application as a compatibility boundary:
syntax/lint/runtime checked, not yet fully TypeScript checked. The repository's
existing strict TypeScript checks are unchanged. `npm run build` stages the client
into dist atomically along with other package artifacts. Test files, fixtures and
private dependencies are excluded from the package; release tooling checks its
exports and can install the tarballs into an empty directory.

MIT applies to the source. See NOTICE for trademark attribution. This code does not
include paid features or grant permission to imply endorsement by Két Việt.
