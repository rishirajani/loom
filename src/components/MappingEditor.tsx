import { useMemo, useRef, useState } from 'react'
import { bundledOntologies } from '../lib/ontologies'
import { suggestMappings } from '../lib/mappingSuggester'
import { slugify } from '../lib/tripleGenerator'
import type { ColumnMapping, MappingConfig, ParsedTable } from '../lib/types'

interface Props {
  table: ParsedTable
  /** previous mapping state, when returning from the results step */
  initial?: MappingConfig
  onMappingReady: (mapping: MappingConfig, ontologyId: string) => void
}

function buildInitialColumns(
  table: ParsedTable,
  ontologyId: string,
  rdfType: string,
): ColumnMapping[] {
  const ontology = bundledOntologies.find((o) => o.id === ontologyId)!
  const suggestions = suggestMappings(table.headers, table.sampleValues, ontology, rdfType)
  const byColumn = new Map(suggestions.map((s) => [s.column, s]))
  return table.headers.map((h) => {
    const s = byColumn.get(h)
    // Weak suggestions (generic token/value evidence only) are never
    // pre-selected — they render as an explicit "possible match" hint instead.
    if (!s || s.strength !== 'strong') return { column: h, kind: 'skip' as const }
    const property = ontology.properties.find((p) => p.id === s.predicate)
    return {
      column: h,
      kind: property?.isObjectProperty ? ('objectRef' as const) : ('literal' as const),
      predicate: s.predicate,
      datatype: property?.range,
    }
  })
}

export function MappingEditor({ table, initial, onMappingReady }: Props) {
  const [ontologyId, setOntologyId] = useState(initial?.ontologyId ?? bundledOntologies[0].id)
  const ontology = useMemo(
    () => bundledOntologies.find((o) => o.id === ontologyId)!,
    [ontologyId],
  )
  const [rdfType, setRdfType] = useState(
    initial?.rdfType ?? bundledOntologies.find((o) => o.id === (initial?.ontologyId ?? bundledOntologies[0].id))!.classes[0].id,
  )
  const [identifierColumn, setIdentifierColumn] = useState<string | null>(
    initial !== undefined ? initial.identifierColumn : (table.headers[0] ?? null),
  )
  const [baseIri, setBaseIri] = useState(initial?.baseIri ?? 'https://example.org/id/')
  const [mergeAcknowledged, setMergeAcknowledged] = useState(false)
  const baseIriValid = /^https?:\/\/\S+$/.test(baseIri.trim())
  const [columns, setColumns] = useState<ColumnMapping[]>(() =>
    initial
      ? initial.columns
      : buildInitialColumns(table, bundledOntologies[0].id, bundledOntologies[0].classes[0].id),
  )
  // Track which columns the user has manually changed, so re-running
  // suggestions (on class/ontology change) never overwrites their work.
  // When restoring a prior mapping, every column counts as touched — the
  // whole point of coming back is that these are the user's decisions.
  const userTouched = useRef(new Set<string>(initial ? table.headers : []))

  // Computed once per (ontology, class) — used both for the initial state
  // above and for the "suggested" badge, so the badge reflects provenance,
  // not coincidence with a manual selection.
  const suggestionMap = useMemo(
    () =>
      new Map(
        suggestMappings(table.headers, table.sampleValues, ontology, rdfType).map((s) => [
          s.column,
          s,
        ]),
      ),
    [ontology, rdfType, table.headers, table.sampleValues],
  )

  function applySuggestionsPreservingUserWork(nextOntologyId: string, nextRdfType: string) {
    const nextOntology = bundledOntologies.find((o) => o.id === nextOntologyId)!
    const fresh = buildInitialColumns(table, nextOntologyId, nextRdfType)
    setColumns((prev) =>
      fresh.map((suggested) => {
        if (userTouched.current.has(suggested.column)) {
          const existing = prev.find((c) => c.column === suggested.column)
          // A touched mapping only survives if its predicate exists in the
          // target ontology AND is domain-compatible with the new class — a
          // schema: predicate carried into DCAT would throw at generation
          // time, and an out-of-domain predicate (birthDate on Organization)
          // would render as a blank dropdown while silently staying in the
          // graph, since the options list is domain-filtered.
          const predicateStillValid =
            existing &&
            (existing.kind === 'skip' ||
              nextOntology.properties.some(
                (p) =>
                  p.id === existing.predicate &&
                  (!p.domain || p.domain.includes(nextRdfType)),
              ))
          if (predicateStillValid) return existing
          userTouched.current.delete(suggested.column)
        }
        return suggested
      }),
    )
  }

  function updateColumn(column: string, patch: Partial<ColumnMapping>) {
    userTouched.current.add(column)
    setColumns((prev) => prev.map((c) => (c.column === column ? { ...c, ...patch } : c)))
  }

  // Identifier-column uniqueness check: duplicate IDs silently merge rows
  // into one subject downstream, so warn before generation, not after.
  // Compared after slugification (using the generator's own slugify) so
  // IRI-level collisions like "a b" vs "a-b" are caught here too.
  const identifierDuplicates = useMemo(() => {
    if (!identifierColumn) return []
    const seenSlugs = new Map<string, string>()
    const dupes = new Set<string>()
    for (const row of table.rows) {
      const v = row[identifierColumn]
      if (!v) continue
      const slug = slugify(v)
      const previous = seenSlugs.get(slug)
      if (previous !== undefined) {
        dupes.add(previous === v ? v : `${previous} / ${v}`)
      } else {
        seenSlugs.set(slug, v)
      }
    }
    return Array.from(dupes)
  }, [identifierColumn, table.rows])

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8">
      <div className="grid sm:grid-cols-3 gap-4">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Ontology</span>
          <select
            aria-label="Target ontology"
            className="mt-1 w-full rounded-md border border-[var(--loom-line)] bg-white px-3 py-2"
            value={ontologyId}
            onChange={(e) => {
              const nextId = e.target.value
              const next = bundledOntologies.find((o) => o.id === nextId)!
              setOntologyId(nextId)
              setRdfType(next.classes[0].id)
              applySuggestionsPreservingUserWork(nextId, next.classes[0].id)
            }}
          >
            {bundledOntologies.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Each row is a</span>
          <select
            aria-label="Class each row represents"
            className="mt-1 w-full rounded-md border border-[var(--loom-line)] bg-white px-3 py-2"
            value={rdfType}
            onChange={(e) => {
              setRdfType(e.target.value)
              applySuggestionsPreservingUserWork(ontologyId, e.target.value)
            }}
          >
            {ontology.classes.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Identifier column</span>
          <select
            aria-label="Identifier column"
            className="mt-1 w-full rounded-md border border-[var(--loom-line)] bg-white px-3 py-2"
            value={identifierColumn ?? ''}
            onChange={(e) => {
              setIdentifierColumn(e.target.value || null)
              setMergeAcknowledged(false)
            }}
          >
            <option value="">(generate automatically)</option>
            {table.headers.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </label>
      </div>

      {identifierDuplicates.length > 0 && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-4 space-y-3">
          <p>
            The column “{identifierColumn}” has duplicate values ({identifierDuplicates.slice(0, 3).join(', ')}
            {identifierDuplicates.length > 3 ? `, +${identifierDuplicates.length - 3} more` : ''}).
            Rows sharing an identifier will merge into a single entity in the graph.
          </p>
          <p>
            This is sometimes intentional — for example, several rows describing different properties of the
            same entity. If it isn’t, pick a unique column or choose “generate automatically” to keep every
            row separate.
          </p>
          <label className="flex items-start gap-2 font-medium cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={mergeAcknowledged}
              onChange={(e) => setMergeAcknowledged(e.target.checked)}
            />
            <span>Merging rows that share an identifier is intentional — generate anyway</span>
          </label>
        </div>
      )}

      <label className="block max-w-md">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Base IRI</span>
        <input
          aria-label="Base IRI for generated entities"
          aria-invalid={!baseIriValid}
          className={`mt-1 w-full rounded-md border bg-white px-3 py-2 font-mono text-sm ${
            baseIriValid ? 'border-[var(--loom-line)]' : 'border-red-400'
          }`}
          value={baseIri}
          onChange={(e) => setBaseIri(e.target.value)}
        />
        {!baseIriValid && (
          <span className="mt-1 block text-xs text-red-600">
            Enter an absolute IRI starting with http:// or https:// — entity identifiers are built by
            appending to this value, so a relative or empty base produces invalid IRIs.
          </span>
        )}
        {baseIriValid && !/[/#]$/.test(baseIri.trim()) && (
          <span className="mt-1 block text-xs text-neutral-500">
            Tip: end the base IRI with / or # — otherwise identifiers concatenate directly
            (…{baseIri.trim().slice(-6)}<strong>1</strong> instead of …{baseIri.trim().slice(-6)}<strong>/1</strong>).
          </span>
        )}
      </label>

      {(() => {
        // Fit signal: if few columns find strong matches, the problem is
        // usually not the matcher — it's that the data doesn't describe the
        // chosen class (e.g. a people spreadsheet mapped as dcat:Dataset).
        const strongCount = Array.from(suggestionMap.values()).filter(
          (s) => s.strength === 'strong',
        ).length
        const relevantColumns = table.headers.filter((h) => h !== identifierColumn).length
        return relevantColumns >= 4 && strongCount <= Math.floor(relevantColumns / 3) ? (
          <p className="text-sm text-neutral-600 bg-neutral-50 border border-[var(--loom-line)] rounded-md p-3">
            Only {strongCount} of {relevantColumns} columns matched{' '}
            <span className="font-medium">{ontology.classes.find((c) => c.id === rdfType)?.label}</span> in{' '}
            {ontology.name}. If that seems low, this data may describe a different kind of thing — try
            another class or ontology above.
          </p>
        ) : null
      })()}

      <div className="border border-[var(--loom-line)] rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3">Column</th>
              <th className="px-4 py-3">Sample value</th>
              <th className="px-4 py-3">Maps to</th>
              <th className="px-4 py-3">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--loom-line)]">
            {columns.map((col) => {
              const suggestion = suggestionMap.get(col.column)
              const isSuggested =
                suggestion &&
                col.predicate === suggestion.predicate &&
                !userTouched.current.has(col.column)
              const candidateProps = ontology.properties.filter(
                (p) => !p.domain || p.domain.includes(rdfType),
              )
              return (
                <tr key={col.column}>
                  <td className="px-4 py-3 font-medium">{col.column}</td>
                  <td className="px-4 py-3 text-neutral-500 font-mono text-xs">
                    {table.sampleValues[col.column]?.[0] ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      aria-label={`Property for column ${col.column}`}
                      className="rounded-md border border-[var(--loom-line)] bg-white px-2 py-1"
                      value={col.kind === 'skip' ? '' : col.predicate}
                      onChange={(e) => {
                        const val = e.target.value
                        if (!val) {
                          updateColumn(col.column, { kind: 'skip', predicate: undefined, datatype: undefined })
                          return
                        }
                        const property = ontology.properties.find((p) => p.id === val)
                        updateColumn(col.column, {
                          kind: property?.isObjectProperty ? 'objectRef' : 'literal',
                          predicate: val,
                          datatype: property?.range,
                        })
                      }}
                    >
                      <option value="">Don’t include</option>
                      {candidateProps.map((p) => (
                        <option key={p.id} value={p.id}>{p.label} ({p.id})</option>
                      ))}
                    </select>
                    {isSuggested && suggestion.strength === 'strong' && (
                      <span className="ml-2 text-xs text-[var(--loom-accent)]" title={suggestion.reason}>
                        suggested · {suggestion.evidence}
                      </span>
                    )}
                    {suggestion &&
                      suggestion.strength === 'weak' &&
                      col.kind === 'skip' &&
                      !userTouched.current.has(col.column) && (
                        <button
                          type="button"
                          className="ml-2 text-xs text-neutral-500 underline decoration-dotted hover:text-[var(--loom-accent)]"
                          title={`Low-confidence match (${suggestion.reason}). Click to apply.`}
                          onClick={() => {
                            const property = ontology.properties.find((p) => p.id === suggestion.predicate)
                            updateColumn(col.column, {
                              kind: property?.isObjectProperty ? 'objectRef' : 'literal',
                              predicate: suggestion.predicate,
                              datatype: property?.range,
                            })
                          }}
                        >
                          possible: {ontology.properties.find((p) => p.id === suggestion.predicate)?.label} ·{' '}
                          {suggestion.evidence} — apply?
                        </button>
                      )}
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">
                    {col.kind === 'objectRef' ? 'reference' : col.kind === 'literal' ? col.datatype ?? 'xsd:string' : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <button
        disabled={(identifierDuplicates.length > 0 && !mergeAcknowledged) || !baseIriValid}
        className="rounded-full bg-[var(--loom-accent)] text-white px-6 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={() =>
          onMappingReady(
            { baseIri: baseIri.trim(), ontologyId, rdfType, identifierColumn, columns },
            ontologyId,
          )
        }
      >
        Generate knowledge graph
      </button>
    </div>
  )
}
