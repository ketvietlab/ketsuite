# KetSuite

Public business modules, the Két design system, and product tools built on
[KetJS](https://github.com/ketvietlab/ketjs). KetJS is installed from npm;
framework source and framework releases remain in that repository.

| Package | Purpose |
| --- | --- |
| `@ketvietlab/ketsuite` | Composable business modules and application scaffold |
| `@ketvietlab/design-system` | Shared components, tokens, catalogue and runtime |
| `@ketvietlab/ketspec` | **Spec**: OpenAPI reference and request console |
| `@ketvietlab/website-client` | Public website client |
| `@ketvietlab/flow-ui` | Flow presentation components |
| `@ketvietlab/flow-client` | Public Flow application client |

## Create an application

```sh
# Run from: /path/to/projects
npx -y @ketvietlab/ketsuite@latest new my_suite
cd my_suite
npm install
npm run dev
```

See [the KetSuite quick start](docs/src/content/docs/ketsuite/quick-start.md)
for deployment selection and secure provisioning.

## Read an OpenAPI document with Spec

After `@ketvietlab/ketspec` is published, install it in the project that owns
its OpenAPI document:

```sh
# Run from: /path/to/project
npm install --save-dev @ketvietlab/ketspec
npx ketspec build openapi.json --out api-docs --lang en
```

The output is a static site; any static file server can host it. Spec accepts
OpenAPI documents independently of the framework that generated them.
See [the package documentation](packages/ketspec/README.md).

## Development and releases

Source development happens in `ketviet/ketsuite/`. This repository receives
committed public snapshots and owns their release gates and npm publication.
`UPSTREAM.json` identifies the source commit and subtree of each snapshot.
Product changes are made in the development source and exported again.

The branch flow is `integration` → `develop` → `master`. Integration has no
full CI; promotion and release pull requests run the broad verification gate.
[RELEASING.md](RELEASING.md) describes snapshot export, package checks,
credentials, versioning and retrying a partial publication.

## Build the public workspace

```sh
# Run from: /path/to/ketsuite
npm ci
npm run build
```

The build emits public package artifacts into `packages/*/dist`.
Local tests are scoped to the affected behavior and deployment; see
[AGENTS.md](AGENTS.md). Building the workspace is not a full-suite test pass.

## License

MIT. Individual packages retain their third-party notices.
