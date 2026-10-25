# Font assets

## KÉT Sans

Két Việt's interface typeface, `--kv-font-sans` and therefore every KétSuite screen.
Release 1.0 (`v1.0.0`) of `ketvietlab/ket-sans-font`, `Optical/` in `KETSans-1.000.zip`
(the ZIP matches the release `SHA256SUMS`). The files are unmodified; against the 0.301
Optical builds only the `head` and `name` tables differ (version metadata).
Light 300, Regular 400, Medium 500 (registered as `500 600`) and Bold 700.

Each file has a single `opsz` axis (8–72, default 16), not a variable weight axis.
`font-optical-sizing: auto` preserves Text spacing through opsz 16, tightens it
progressively and reaches Display spacing at opsz 48. Glyph shapes are unchanged.
The browser selects optical size; CSS pixel mapping can differ between engines.
Keep the CSS family alias `KÉT Sans` and existing weight mapping.

- `KETSansOptical-Light.woff2`: SHA-256 `7048f868770ac41dafe5c6344e92a0c85534363b21ad7494c55a62864dd6e6dd`.
- `KETSansOptical-Regular.woff2`: SHA-256 `8301678d5a34bf0bdef74c58de99bb98c159d8a6431719d7f3de87d25db215be`.
- `KETSansOptical-Medium.woff2`: SHA-256 `47128d9d4f2957491048c3316ad5e722623f2ea0ddcdd870981484f882c454fe`.
- `KETSansOptical-Bold.woff2`: SHA-256 `8222cbade945a1e52994f35aaac20e4dd3167a7a131630d188649140ac3b2568`.

These Optical builds are unhinted (smart dropout only). Windows/ClearType and
Safari/WebKit have not been verified. Release checks recorded 156 optical
checks passing and OTS passing for all eight Optical TTF/WOFF2 files. Universal
FontBakery still reports five failures for fixed-weight, opsz-only families
(three regular-instance naming checks and two Bold style-bit checks); do not
interpret these artifacts as having a clean FontBakery report.

KÉT Sans is not open source and not MIT. `KETSans-LICENSE.txt` (KÉT Sans Font License
1.0) allows free use, commercial use and embedding, but not modifying or redistributing the
font files. Replace these files only with a new release from the font project, never with
an edited copy.

## Inter

Unmodified Inter 4.1 variable WOFF2 fonts from the official
[Inter project](https://github.com/rsms/inter/releases/tag/v4.1), pinned to commit
`e3a3d4c57d5ecc01453a575621882a384c1995a3` (`docs/font-files/`). Inter follows KÉT Sans in
`--kv-font-sans`: it draws the characters KÉT Sans does not have. KÉT Sans has no italic
yet, so italic text is its upright face slanted by the browser, not Inter Italic.

- `InterVariable.woff2`: SHA-256 `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3`.
- `InterVariable-Italic.woff2`: SHA-256 `e564f652916db6c139570fefb9524a77c4d48f30c92928de9db19b6b5c7a262a`.

The upstream SIL Open Font License is reproduced in `LICENSE.txt` and shipped with
the package. Both files support the full upstream character set and weight range.
Do not replace these with a Latin-only subset that drops Vietnamese characters.
