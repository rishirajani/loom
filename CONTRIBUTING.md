# Contributing to Loom

Thanks for considering it. Loom is early, so contributions can still shape the direction of the project. This guide explains how to run the project, where the important code lives, and what to check before opening a pull request.

## Getting set up

```bash
npm install
npm run dev
```

No backend, no accounts, no API keys — everything runs in the browser.

Loom currently expects Node 20.19+ or newer because the Vite/Rolldown toolchain requires it. If install or build fails with a native binding error, remove `node_modules` and reinstall with a supported Node version:

```bash
rm -rf node_modules package-lock.json
npm install
```

## Before opening a PR

Please run the full local check:

```bash
npm test
npm run build
npm run lint
```

The test suite does more than check implementation details. Several tests pin product and semantic decisions that came out of real failure cases:

- `hire_date` should not be pre-selected as `schema:birthDate`.
- `manager_id` should map to `schema:colleague`, not `schema:worksFor`.
- Unknown prefixes should throw instead of silently producing invalid RDF.
- Slug collisions should be detected before generation.
- Identifier fallback IRIs should be deterministic.

If a test fails, read the test comment before changing the assertion. It may be documenting a bug Loom already shipped once.

## Where to look first

- `src/lib/types.ts` — core data model: ontologies, mappings, parsed tables, and mapping configs.
- `src/lib/mappingSuggester.ts` — the suggestion engine: lexical matching, curated aliases, value-pattern checks, and strong/weak evidence tiers. This is where the future embedding-based matcher will likely integrate.
- `src/lib/tripleGenerator.ts` — converts parsed rows and mapping configs into RDF quads, then serializes Turtle.
- `src/lib/csvParser.ts` — CSV parsing and parse-warning handling.
- `src/components/FileImport.tsx` — upload/import step.
- `src/components/MappingEditor.tsx` — ontology/class selection, column mapping, duplicate/IRI gates, and suggestion UI.
- `src/components/ResultsView.tsx` — Turtle preview, download, warnings, unmapped-column reporting, and back-to-mapping flow.

## Good first areas

- **Keyboard-accessible file import** — improve the drag/drop zone so it is fully usable without a mouse.
- **Suggestion tie-breaking** — make equally plausible matches explainable and deterministic beyond current declaration order.
- **More bundled aliases** — add small, well-tested synonym sets for common CSV headers.
- **Documentation examples** — add before/after CSV-to-Turtle examples for Schema.org and DCAT.
- **Extract mapping-preservation logic** — move component-level mapping preservation decisions into a pure helper so they can be unit-tested.

## Larger roadmap areas

- **Large-file support** — stream CSV parsing and/or move heavy work into a Web Worker.
- **Multi-namespace ontology support** — replace hardcoded prefix exceptions with declared prefix maps.
- **Embedding-based suggestions** — improve beyond lexical/Jaccard matching using local browser models.
- **Suggester weight calibration** — build a small evaluation set and tune confidence/strength behavior.
- **Excel import** — support `.xlsx` through a client-side parser.
- **SPARQL querying** — add an in-browser query step with Oxigraph-WASM.
- **SHACL validation** — validate generated graphs with human-readable error messages.

## Design principles to keep in mind

- **Nothing leaves the browser by default.** Any feature that sends data to a server, including LLM-assisted mapping or external graph connectors, must be explicit, opt-in, and clearly separated from the local-first path.
- **Correctness gates should block; completeness hints should not.** Invalid Base IRIs and unacknowledged identifier collisions block generation. Weak suggestions and unmapped columns warn, but do not force users into bad mappings.
- **Do not pre-select weak semantic evidence.** Value-pattern evidence alone can tell us that a column contains dates, URLs, or numbers. It cannot tell us which property those values mean.
- **Use real ontologies carefully.** If an alias maps to a property, check the property’s domain/range semantics. `manager_id → schema:worksFor` looked useful but was wrong; `schema:colleague` is the safer Person-to-Person mapping.
- **Prefer explicit warnings over silent magic.** If Loom drops a column, merges rows, or uses a column as identity, the UI should say so.

## Reporting issues

Open a GitHub issue with a clear repro when possible. A small sample CSV, the selected ontology/class, and what mapping you expected are usually enough.

For feature ideas, include the user problem first. A short explanation of why the feature matters is more useful than a complete implementation plan.
