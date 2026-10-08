# Releasing KetSuite

KetSuite is developed in `ketviet/ketsuite/`. This public repository receives
committed snapshots; its source is not an independent development branch.
`UPSTREAM.json` records the source commit, public subtree hash and version.

## Prepare in the development repository

1. Merge the product change into KetViet `integration`. Broad verification belongs
   to its promotion into `develop`; local work uses focused producer and deployment
   checks. Do not run unrelated deployments locally to prepare a snapshot.
2. Prepare the coordinated version in `ketsuite/package.json`, each public package,
   exact internal dependencies, `package-lock.json` and the KetSuite scaffold.
   Existing npm versions are immutable; changed source needs a new version.
3. Run focused checks for the affected package and inspect the packed artifacts.
   Commit the source, release tooling and documentation together.
4. From the KetViet checkout, preview the export into a clean public checkout:

```sh
# Run from: /path/to/ketviet
node tools/ketsuite/export.mjs --ref <source-commit> --target /path/to/ketsuite
node tools/ketsuite/export.mjs --ref <source-commit> --target /path/to/ketsuite --apply --stage
```

The exporter copies only committed files under `ketsuite/`, refuses private content
and secrets, preserves Git metadata, removes obsolete tracked files and refuses
a dirty target. Machine-local `.claude/` and `.codex/` configuration is excluded;
the public address dataset's required attribution remains intact.
`--stage` stages exactly the exported files and tracked removals, including existing
upstream documentation assets that match ignore rules. Local dependencies and build
outputs are not staged. It does not commit, push or publish. Review and commit the snapshot
on a sync branch, then open a pull request into public `integration`.

## Promotion and release

- `integration` receives reviewed snapshots and has no automatic full CI.
- Promote `integration` into `develop`; `verify.yml` owns the broad verification gate.
- Require the stable `verification gate` check on `develop` and `master`, plus
  `permission coverage` on `develop`. The gate rejects failed, cancelled or skipped
  test jobs when the planner selected them; an unselected group may be skipped.
- Create `release/<version>` from verified `develop`, then open a release PR into
  `master`. Keep the coordinated version and source provenance in that PR.
- After the release gate passes and the PR is merged, create GitHub release
  `v<version>` at that exact `master` commit. The tag must match the root version.
- `release.yml` checks that the tagged commit belongs to `master`, runs verification
  and clean-room package checks, then publishes with npm provenance.

The first snapshot prepares `0.1.41`; preparing the version does not publish it.
Source changes made while reviewing a snapshot must be fixed in KetViet and exported
again. Do not maintain a second set of product patches in this repository.

## npm publishing setup

Create the GitHub environment `npm` and configure an `NPM_TOKEN` that can publish
public packages under `@ketvietlab`. The release workflow requests `id-token: write`
for provenance. After the initial publication, npm trusted publishing can replace
the token when configured for organization `ketvietlab`, repository `ketsuite`,
workflow filename `release.yml` and environment `npm`. Trusted publishing requires
a GitHub-hosted runner and npm CLI 11.5.1 or newer; see the
[npm setup instructions](https://docs.npmjs.com/trusted-publishers/).

The `npm` environment permits the `master` branch and `v*` tags. A release is
triggered only by publishing a GitHub release or dispatching an existing tag;
pushing a snapshot does not publish packages.

No credentials are stored in the source tree. Missing npm authorization prevents
publication; it does not prevent preparing and checking the snapshot.

## Package checks

```sh
# Run from: /path/to/ketsuite
npm ci
npm run build
node tools/release.mjs pack
```

The build currently compiles the complete public workspace. The direct release
tool checks metadata, exports, licenses and size ceilings, installs the tarballs
in a clean consumer, imports the public entry points, builds a Spec static site,
and checks the generated KetSuite application's CLI. This is package verification,
not a full repository regression pass. Do not substitute local `npm run verify`
or `npm run release:check` for focused development checks.

The coordinated release publishes these packages in dependency order:

1. `@ketvietlab/design-system`
2. `@ketvietlab/ketspec`
3. `@ketvietlab/ketsuite`
4. `@ketvietlab/website-client`
5. `@ketvietlab/flow-ui`
6. `@ketvietlab/flow-client`

KetJS and KetJS View are npm dependencies released from their own repository.

## Retry a partial publication

```sh
# Run from: /path/to/ketsuite
gh workflow run release.yml --ref master -f tag=v<version>
```

The release tool skips a package only when its existing npm tarball checksum
matches the current artifact. It refuses different bytes at the same version.
Keep the original tag immutable and fix any new product changes in a new version.
