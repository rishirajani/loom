# Loom

**Turn a spreadsheet into a standards-based knowledge graph — entirely in your browser. No server, no upload, no data leaves your machine.**

Loom takes a CSV, helps you map its columns onto a real ontology, and generates valid RDF/Turtle for local download. The current MVP ships with bundled Schema.org and DCAT subsets, assisted column mapping, duplicate-identifier safeguards, and clear warnings when data is skipped or the selected ontology/class does not fit the spreadsheet.

## Why

RDF and knowledge graphs are powerful, but the tooling often assumes you already know the semantic web stack. Turning a spreadsheet into RDF can quickly become a wall of unfamiliar concepts: IRIs, classes, predicates, object properties, datatypes, prefixes, SPARQL, SHACL, and mapping languages.

Loom's goal is to make the first step approachable: upload a CSV, choose what each row represents, map columns with help from ontology-aware suggestions, and export a valid graph you can inspect or load into other RDF tools.

The bet behind Loom is simple: good ontology tooling should not hide semantics, but it should guide users through them.

## Status

**MVP / early open source.**

Current flow:

```text
CSV import → assisted ontology mapping → RDF triple generation → Turtle export
```

Not shipped yet: SPARQL querying, SHACL validation, Excel import, arbitrary ontology upload, and embedding-based semantic matching. These are listed in the roadmap below.

## Try it locally

```bash
npm install
npm run dev
```

Then open the local Vite URL, usually:

```text
http://localhost:5173/
```

You can try the included sample file:

```text
examples/sample-people.csv
```

Before opening a pull request or publishing a build, run:

```bash
npm test
npm run build
npm run lint
```

## How it works

1. **Import** — CSV parsing happens locally in the browser via PapaParse. Parse warnings are surfaced instead of silently ignored.

2. **Map** — choose a bundled ontology and class, then map CSV columns to ontology properties. Loom suggests matches using lexical similarity, curated aliases, and value-pattern checks against declared datatypes.

3. **Review suggestion strength** — suggestions are intentionally tiered:
   - **Strong suggestions** have real name or synonym evidence and can be pre-selected.
   - **Weak suggestions** are opt-in hints. They are not auto-selected, because value shape alone can be misleading. For example, an early build suggested `hire_date → schema:birthDate` because the values looked like dates. Loom now treats that as a weak hint, not a trusted mapping.

4. **Protect graph integrity** — Loom checks for duplicate or slug-colliding identifiers and requires explicit merge consent when rows would become the same entity.

5. **Generate** — triples are built with N3.js and serialized to Turtle. Identifier columns become entity IRIs, skipped columns are reported, and fallback row IRIs are deterministic.

## What Loom currently does well

- Local-first CSV-to-RDF export
- Bundled Schema.org and DCAT ontology subsets
- Strong/weak mapping suggestions
- Curated alias handling, such as `manager_id → schema:colleague`
- Object references between rows when values point to another row identifier
- Duplicate identifier and IRI-collision detection
- Base IRI validation and helpful trailing `/` or `#` guidance
- Coverage warning when the selected class appears to be a poor fit
- Turtle preview and download
- Back-to-mapping flow with mapping state preserved

## Known limitations

- Large CSVs are not streamed through a worker yet.
- Ontology support is bundled and limited; arbitrary OWL/RDFS/Turtle upload is planned.
- The suggester is heuristic, not a calibrated probability model.
- Synonyms and aliases are curated manually for now.
- SPARQL querying and SHACL validation are not implemented yet.
- Mapping-preservation logic currently lives in the React component and should be extracted for easier unit testing.
- Drag-and-drop import still needs stronger keyboard accessibility.

## Roadmap

- [x] CSV import with parse warnings
- [x] Ontology-aware column mapping
- [x] Tiered suggestions: strong pre-selected matches, weak opt-in hints
- [x] Curated alias support
- [x] Duplicate identifier and slug-collision detection
- [x] Explicit merge consent for duplicate entities
- [x] Deterministic RDF/Turtle export
- [x] Unmapped-column reporting
- [x] Ontology/class coverage warning
- [ ] Excel (`.xlsx`) import
- [ ] In-browser SPARQL querying with Oxigraph-WASM
- [ ] SHACL validation with human-readable errors
- [ ] Embedding-based semantic mapping suggestions
- [ ] Mapping config save/reuse
- [ ] Bring-your-own ontology upload
- [ ] Multi-namespace ontology support
- [ ] Large-file streaming and/or web worker support
- [ ] Keyboard-accessible drag-and-drop import
- [ ] Suggestion weight calibration and evaluation set

## Design principles

- **Local-first is the trust anchor.** CSV files, mappings, and generated graphs should stay on the user's machine by default.
- **Correctness beats convenience.** Loom blocks invalid graph generation, but it does not force users to accept uncertain suggestions.
- **Hints are for completeness; gates are for correctness.** Weak suggestions can be ignored. Invalid Base IRIs and unacknowledged entity merges cannot.
- **Ontology semantics matter.** `manager_id → schema:worksFor` looked useful but was semantically wrong for person-to-person references. Loom now maps that case to `schema:colleague` instead.
- **The UI should explain what happened.** Identifier columns become IRIs, skipped columns are reported, and low coverage is called out.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

Good first issues include documentation improvements, accessibility polish, Excel import exploration, and test extraction for mapping-preservation logic.

## License

MIT — see [LICENSE](./LICENSE).
