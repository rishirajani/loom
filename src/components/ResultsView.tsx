import { useEffect, useState } from 'react'
import { generateTriples, quadsToTurtle, slugify } from '../lib/tripleGenerator'
import { bundledOntologies } from '../lib/ontologies'
import type { MappingConfig, ParsedTable } from '../lib/types'

interface Props {
  table: ParsedTable
  mapping: MappingConfig
  onBack: () => void
  onStartOver: () => void
}

interface Stats {
  rowCount: number
  tripleCount: number
  warnings: string[]
  duplicateIdentifiers: string[]
}

export function ResultsView({ table, mapping, onBack, onStartOver }: Props) {
  const [turtle, setTurtle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    setError(null)
    setTurtle('')
    try {
      const ontology = bundledOntologies.find((o) => o.id === mapping.ontologyId)
      if (!ontology) throw new Error(`Unknown ontology "${mapping.ontologyId}".`)
      const result = generateTriples(table, mapping, ontology)
      setStats({
        rowCount: result.rowCount,
        tripleCount: result.tripleCount,
        warnings: result.warnings,
        duplicateIdentifiers: result.duplicateIdentifiers,
      })
      quadsToTurtle(result.quads, ontology)
        .then(setTurtle)
        .catch((e: unknown) =>
          setError(e instanceof Error ? e.message : 'Serialization failed.'),
        )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Graph generation failed.')
    }
  }, [table, mapping])

  function download() {
    const blob = new Blob([turtle], { type: 'text/turtle' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'graph.ttl'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (error) {
    return (
      <div className="w-full max-w-4xl mx-auto space-y-4">
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-4">
          Couldn’t generate the graph: {error}
        </p>
        <button
          onClick={onBack}
          className="rounded-full border border-[var(--loom-line)] px-6 py-2 text-sm font-medium hover:bg-neutral-50 transition-colors"
        >
          Back to mapping
        </button>
        <button
          onClick={onStartOver}
          className="rounded-full border border-[var(--loom-line)] px-6 py-2 text-sm font-medium hover:bg-neutral-50 transition-colors"
        >
          Start over
        </button>
      </div>
    )
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {stats && (
        <div className="flex flex-wrap gap-6 text-sm">
          <div><span className="font-semibold">{stats.rowCount}</span> rows</div>
          <div><span className="font-semibold">{stats.tripleCount}</span> triples generated</div>
          {stats.warnings.length > 0 && (
            <div className="text-amber-700">{stats.warnings.length} warning(s)</div>
          )}
        </div>
      )}

      {(() => {
        const skipped = mapping.columns
          .filter((c) => c.kind === 'skip')
          .map((c) => c.column)
          .filter((c) => c !== mapping.identifierColumn)
        return (
          <>
            {mapping.identifierColumn && (
              <p className="text-xs text-neutral-500">
                <span className="font-mono">{mapping.identifierColumn}</span> was used to build the
                entity IRIs, e.g.{' '}
                <span className="font-mono">
                  {mapping.baseIri}
                  {table.rows[0]?.[mapping.identifierColumn]
                    ? slugify(table.rows[0][mapping.identifierColumn])
                    : '…'}
                </span>
                — it appears as identity, not as a property.
              </p>
            )}
            {skipped.length > 0 && (
              <p className="text-sm text-neutral-600 bg-neutral-50 border border-[var(--loom-line)] rounded-md p-3">
                {skipped.length} column{skipped.length > 1 ? 's were' : ' was'} not included in the graph:{' '}
                <span className="font-mono text-xs">{skipped.join(', ')}</span>. If any of these should be
                in the graph, go back and map them — unmapped columns are dropped, not deferred.
              </p>
            )}
          </>
        )
      })()}

      {stats && stats.duplicateIdentifiers.length > 0 && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
          {stats.duplicateIdentifiers.length} identifier value(s) appear on multiple rows
          ({stats.duplicateIdentifiers.slice(0, 3).join(', ')}
          {stats.duplicateIdentifiers.length > 3 ? ', …' : ''}) — those rows were merged into
          single entities. If that’s not intended, go back and choose a unique identifier column.
        </p>
      )}

      {stats && stats.warnings.length > 0 && (
        <ul className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3 space-y-1">
          {stats.warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}

      <pre className="bg-neutral-900 text-neutral-100 rounded-lg p-4 overflow-auto text-xs max-h-96 font-mono">
        {turtle || 'Generating…'}
      </pre>

      <div className="flex gap-3">
        <button
          onClick={download}
          disabled={!turtle}
          className="rounded-full bg-[var(--loom-ink)] text-white px-6 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Download graph.ttl
        </button>
        <button
          onClick={onBack}
          className="rounded-full border border-[var(--loom-line)] px-6 py-2 text-sm font-medium hover:bg-neutral-50 transition-colors"
        >
          Back to mapping
        </button>
        <button
          onClick={onStartOver}
          className="rounded-full border border-[var(--loom-line)] px-6 py-2 text-sm font-medium hover:bg-neutral-50 transition-colors"
        >
          Start over
        </button>
      </div>

      <p className="text-xs text-neutral-500">
        SPARQL querying and SHACL validation are next on the roadmap — see the project README.
      </p>
    </div>
  )
}
