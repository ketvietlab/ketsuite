# Font assets

## KÉT Sans is not in this package

KÉT Sans is Két Việt's typeface. Its licence allows use but not redistribution of the
font files, and its use is limited to Két Việt products, so this package does not ship
it. Releases up to 0.1.43 bundled KÉT Sans Optical 1.0; from the next release the
package carries only Inter.

`--kv-font-sans` still names `"KÉT Sans"` before Inter. A Két Việt product that
registers KÉT Sans with its own `@font-face` rules and its own copy of the files gets it
everywhere the token applies; a system with KÉT Sans installed does too.
Every other consumer renders Inter. Such a registration keeps the family name
`KÉT Sans` and registers Medium for `500 600`, so 600 never falls through to Bold.

## Inter

Unmodified Inter 4.1 variable WOFF2 fonts from the official
[Inter project](https://github.com/rsms/inter/releases/tag/v4.1), pinned to commit
`e3a3d4c57d5ecc01453a575621882a384c1995a3` (`docs/font-files/`). Inter is the interface
typeface of `--kv-font-sans`, including italic. Where KÉT Sans is registered, Inter draws
the characters KÉT Sans does not have; KÉT Sans has no italic yet, so there italic text is
its upright face slanted by the browser, not Inter Italic.

- `InterVariable.woff2`: SHA-256 `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3`.
- `InterVariable-Italic.woff2`: SHA-256 `e564f652916db6c139570fefb9524a77c4d48f30c92928de9db19b6b5c7a262a`.

The upstream SIL Open Font License is reproduced in `LICENSE.txt` and shipped with
the package. Both files support the full upstream character set and weight range.
Do not replace these with a Latin-only subset that drops Vietnamese characters.
