# Fonts (per-clinic, self-hosted)

Inter Variable WOFF2 files are bundled here as the **template default** and
serve as a working example. They are licensed under the SIL Open Font License
1.1 — bundling is permitted; attribution lives in `LICENSE-INTER` at the
bottom of this README.

## Onboarding a new clinic

1. Copy this directory to the new clinic's public folder:
   `cp -r public/clinics/_template/fonts public/clinics/<slug>/fonts`
2. Replace the WOFF2 files with the clinic's licensed font files. Keep
   filenames stable, or update `clinic.brand.fonts[]` in `clinic.ts`.
3. Adjust `clinic.brand.fontFamily` to the family name expected by the
   `@font-face` blocks (e.g. `"Inter"`, `"GT Walsheim"`, `"Söhne"`).

## Why self-host?

The EuGH München ruling of 2022 confirms that loading Google Fonts directly
from `fonts.gstatic.com` transmits the visitor IP without consent and is a
DSGVO violation. Self-hosting eliminates that risk surface entirely.

If a clinic _insists_ on Google Fonts, set `clinic.brand.googleFontsUrl` —
the layout will preconnect and load it, but you must mention it in the
clinic's `datenschutzMarkdown`.

## LICENSE-INTER

Inter is licensed under the SIL Open Font License 1.1.
Copyright (c) 2016-2024 The Inter Project Authors (https://github.com/rsms/inter).
Full license: https://github.com/rsms/inter/blob/master/LICENSE.txt
