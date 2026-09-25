# Tax-rule release operations

`tax-rules/in/<financial-year>/vN.json` and its detached `.sig` are immutable
release artifacts. The initial FY 2026-27 pack mirrors the production
`TAX_RULES_DEFAULT` object in `index.html`; its metadata and source links are
release-only fields. The engine's known scope boundary is preserved: one shared
`otherLtRate` covers supported non-111A/112A long-term gains. This workflow does
not invent the richer capital-gains categories available in the workbook.

(Note: the *runtime* app's own `S.taxRules.cg` has since grown a richer
per-class `classes` model — see `pechak-documentation.md` §7 item 14 — but that
is purely local state migration, independent of this publishing schema, and
does not change what this pack publishes or how it's validated.)

The checked-in `pechak-release-2026-01.pub.pem` key and existing signature are
the repository release key, not a claim about external production custody. Its
PKCS#8 private key was generated only for the initial repository release,
kept outside Git, used through `--private-key`, and removed after signing. A
production operator should create and back up a replacement private key in an
access-controlled secret manager or offline signing device, commit the new public
key under a new key ID, and use the old and new IDs to make rotation explicit.
Private keys must never be copied into this repository; `.gitignore` blocks common
private-key names and `tax-rules/private/`.

Bootstrap a key only with an absolute destination outside the checkout:

```text
npm run tax-rules:keygen -- --key-id pechak-release-YYYY-NN --private-key-out C:\secure\pechak-release-YYYY-NN.pk8
```

The command refuses repository-local private-key paths, creates both files with
exclusive writes, uses PKCS#8 PEM for the private key and SPKI PEM for the public
key, and removes the new private file if public-key creation fails. Move the
private file into approved custody before signing and delete any working copy
afterward.

## Release sequence

1. Copy the preceding pack to a new candidate path outside the immutable release
   directory and update rules using official government sources.
2. Run `npm run tax-rules:validate -- <candidate.json>`.
3. Run `npm test`; this includes semantic/schema/signature negative tests, reviewed
   synthetic tax goldens through the real browser engine, and the existing golden
   regression suite.
4. Review `npm run tax-rules:diff -- <old.json> <candidate.json>`.
5. Sign without touching the index:
   `npm run tax-rules:sign -- <candidate.json> --private-key <outside-repo.pk8> --key-id <id> --output <candidate.sig>`.
6. Verify with
   `npm run tax-rules:verify -- <candidate.json> <candidate.sig> --public-key tax-rules/keys/<id>.pub.pem`.
7. Promote only after review:
   `npm run tax-rules:promote -- <candidate.json> <candidate.sig>`.
   Promotion refuses duplicates/overwrites, verifies both artifacts, copies them
   to their FY/version path, and atomically updates `index.json` last. For the
   repository's first pack, pass its already-final paths; promotion verifies them
   in place and creates the first index as the final operation.
8. Run `npm run build` and verify the published static files from a clean checkout.

`tax-rules:sign` never edits `index.json`. `tax-rules:promote` is the only command
that promotes an index entry. Runtime fetch/banner/review/apply, local override
conflicts, caching/history/rollback, and richer workbook capital-gains support are
explicitly outside this publishing-only release.
