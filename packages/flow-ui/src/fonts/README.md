# Inter assets

Flow loads the real Inter family through `../fonts.css`, keeping Két's typography
identity in Core, Pro and the component demo. Assets resolve relative to the
stylesheet and stay on the product's origin. No CDN request or new runtime
dependency is needed. Other glyphs, including Japanese, use the existing Két font
stack fallback; these Inter subsets do not claim to cover Japanese characters.

Upstream: [Inter](https://rsms.me/inter/) by the Inter Project Authors.
License: [SIL Open Font License 1.1](./LICENSE), retained with the files in dist.
The normal variable font supports weights 100–900. Latin, Latin Extended and
Vietnamese declarations and unmodified binaries were reused from this repository's
`apps/superchat/priv/static/workspace/v2/fonts` on 2026-10-08. Flow owns its copy;
there is no runtime dependency on that application. The original asset version was
not recorded; SHA-256 identifies the exact vendored files.

| File | SHA-256 |
| --- | --- |
| inter-latin-wght-normal.woff2 | 3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62 |
| inter-latin-ext-wght-normal.woff2 | 34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956 |
| inter-vietnamese-wght-normal.woff2 | 5c66f9e07e90c6d4ac4922cc68d60de26c17b1858e677fb5e603fce3952b3ff2 |

`styles.css` imports `fonts.css`; the public build copies both CSS and font assets
into dist. Hosts serving the kit's stylesheet must also serve its relative files.
