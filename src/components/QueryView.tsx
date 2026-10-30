import { useEffect, useMemo, useRef, useState } from 'react'
import { QueryCancelledError, QueryError, type SparqlClient } from '../lib/sparql/client'
import type { QueryResult } from '../lib/sparql/engine'
import type { FriendlyError } from '../lib/sparql/errors'
import { ntriplesToTurtle, resultsToCsv, termLabel, termTitle } from '../lib/sparql/format'
import { starterQueries } from '../lib/sparql/starterQueries'
import { downloadText } from '../lib/download'
import type { MappingConfig, Ontology } from '../lib/types'

interface Props {
  /** the shared engine, owned by GraphWorkspace */
  client: SparqlClient
  engineFailed: boolean
  mapping: MappingConfig
  ontology: Ontology
  prefixes: Record<string, string>
}

type Outcome =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number }
  | { status: 'done'; result: QueryResult; ms: number; turtle?: string }
  | { status: 'error'; error: FriendlyError }
  | { status: 'cancelled' }

// Rendering thousands of rows makes the page sluggish and helps nobody read
// them; the downloads always contain every row.
const MAX_ROWS_SHOWN = 500

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const runShortcut = isMac ? '⌘ Enter' : 'Ctrl Enter'

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function QueryView({ client, engineFailed, mapping, ontology, prefixes }: Props) {
  const starters = useMemo(() => starterQueries(mapping, ontology), [mapping, ontology])
  const [selectedStarter, setSelectedStarter] = useState(starters[0]?.id ?? '')
  const [query, setQuery] = useState(starters[0]?.query ?? '')
  const [edited, setEdited] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>({ status: 'idle' })
  const [elapsed, setElapsed] = useState(0)
  const runSeq = useRef(0)

  // Live elapsed time, so a slow query visibly isn't a frozen page.
  useEffect(() => {
    if (outcome.status !== 'running') return
    const started = outcome.startedAt
    const id = setInterval(() => setElapsed(performance.now() - started), 200)
    return () => clearInterval(id)
  }, [outcome])

  async function run() {
    if (outcome.status === 'running' || !query.trim()) return
    const seq = ++runSeq.current
    setElapsed(0)
    setOutcome({ status: 'running', startedAt: performance.now() })
    try {
      // After a cancel, run() transparently restarts the engine with the same
      // graph, so the triple count shown above stays true.
      const { result, ms } = await client.run(query)
      if (seq !== runSeq.current) return
      const pretty = result.kind === 'graph' ? await ntriplesToTurtle(result.ntriples, prefixes) : undefined
      if (seq !== runSeq.current) return
      setOutcome({ status: 'done', result, ms, turtle: pretty })
    } catch (e) {
      if (seq !== runSeq.current) return
      if (e instanceof QueryCancelledError) setOutcome({ status: 'cancelled' })
      else if (e instanceof QueryError) setOutcome({ status: 'error', error: e.detail })
      else setOutcome({ status: 'error', error: { message: e instanceof Error ? e.message : String(e) } })
    }
  }

  function cancel() {
    client.cancel()
  }

  function pickStarter(id: string) {
    const starter = starters.find((s) => s.id === id)
    if (!starter) return
    if (edited && query !== starter.query && !window.confirm('Replace your edited query with this starter query?')) {
      return
    }
    setSelectedStarter(id)
    setQuery(starter.query)
    setEdited(false)
  }

  const running = outcome.status === 'running'
  const selected = starters.find((s) => s.id === selectedStarter)

  return (
    <div className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-2">
          Start from a query built from your mapping
        </legend>
        <div className="flex flex-wrap gap-2">
          {starters.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pickStarter(s.id)}
              aria-pressed={s.id === selectedStarter && !edited}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                s.id === selectedStarter && !edited
                  ? 'border-[var(--loom-accent)] bg-[var(--loom-accent)] text-white'
                  : 'border-[var(--loom-line)] hover:bg-[var(--loom-hover)] hover:border-[var(--loom-thread-light)]'
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>
        {selected && !edited && <p className="text-xs text-neutral-500">{selected.description}</p>}
      </fieldset>

      <div className="space-y-2">
        <label htmlFor="sparql-editor" className="text-sm font-medium">
          SPARQL query
        </label>
        <textarea
          id="sparql-editor"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setEdited(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void run()
            }
          }}
          spellCheck={false}
          wrap="off"
          autoCapitalize="off"
          autoCorrect="off"
          rows={Math.min(22, Math.max(10, query.split('\n').length + 1))}
          aria-describedby="sparql-editor-help"
          className="w-full rounded-lg border border-[var(--loom-line)] bg-white p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--loom-accent)]"
        />
        <p id="sparql-editor-help" className="text-xs text-neutral-500">
          Read-only: SELECT, ASK, CONSTRUCT and DESCRIBE. Press {runShortcut} to run.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void run()}
          disabled={running || engineFailed || !query.trim()}
          className="rounded-full bg-[var(--loom-ink)] text-white px-6 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? 'Running…' : 'Run query'}
        </button>
        {running && (
          <>
            <button
              onClick={cancel}
              className="rounded-full border border-red-300 text-red-700 px-6 py-2 text-sm font-medium hover:bg-red-50 transition-colors"
            >
              Cancel
            </button>
            <span className="text-xs text-neutral-500 tabular-nums">{formatMs(elapsed)}</span>
          </>
        )}
      </div>

      <Results
        outcome={outcome}
        prefixes={prefixes}
        onAddPrefixes={(lines) => {
          setQuery(`${lines.join('\n')}\n${query}`)
          setEdited(true)
          setOutcome({ status: 'idle' })
        }}
      />
    </div>
  )
}

function Results({
  outcome,
  prefixes,
  onAddPrefixes,
}: {
  outcome: Outcome
  prefixes: Record<string, string>
  onAddPrefixes: (lines: string[]) => void
}) {
  if (outcome.status === 'idle' || outcome.status === 'running') return null

  if (outcome.status === 'cancelled') {
    return (
      <p role="status" className="text-sm text-neutral-600 bg-neutral-50 border border-[var(--loom-line)] rounded-md p-3">
        Query cancelled. The engine restarts automatically on your next run.
      </p>
    )
  }

  if (outcome.status === 'error') {
    return (
      <div role="alert" className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md p-3 space-y-1">
        <p>{outcome.error.message}</p>
        {outcome.error.hint && (
          <p className="text-xs text-red-700 font-mono whitespace-pre-wrap">{outcome.error.hint}</p>
        )}
        {outcome.error.fixPrefixes && (
          <button
            onClick={() => onAddPrefixes(outcome.error.fixPrefixes!)}
            className="mt-2 rounded-full border border-red-300 bg-white px-4 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 transition-colors"
          >
            Add {outcome.error.fixPrefixes.length > 1 ? 'these PREFIX lines' : 'this PREFIX line'} to the query
          </button>
        )}
      </div>
    )
  }

  const { result, ms } = outcome
  const secondaryButton =
    'rounded-full border border-[var(--loom-line)] px-4 py-1.5 text-xs font-medium hover:bg-[var(--loom-hover)] hover:border-[var(--loom-thread-light)] transition-colors'

  if (result.kind === 'ask') {
    return (
      <div role="status" className="rounded-md border border-[var(--loom-line)] bg-white p-4 space-y-1">
        <p className="text-2xl font-semibold">{result.value ? 'Yes' : 'No'}</p>
        <p className="text-xs text-neutral-500">
          ASK returned {String(result.value)} · {formatMs(ms)}
        </p>
      </div>
    )
  }

  if (result.kind === 'graph') {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm">
            <span className="font-semibold">{result.tripleCount}</span> triple{result.tripleCount === 1 ? '' : 's'} ·{' '}
            <span className="text-neutral-500">{formatMs(ms)}</span>
          </p>
          <button
            className={secondaryButton}
            disabled={!outcome.turtle}
            onClick={() => downloadText(outcome.turtle ?? '', 'query-result.ttl', 'text/turtle')}
          >
            Download .ttl
          </button>
        </div>
        <pre className="bg-neutral-900 text-neutral-100 rounded-lg p-4 overflow-auto text-xs max-h-96 font-mono">
          {result.tripleCount === 0 ? '# No triples matched.' : outcome.turtle ?? result.ntriples}
        </pre>
      </div>
    )
  }

  const shown = result.rows.slice(0, MAX_ROWS_SHOWN)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm">
          <span className="font-semibold">{result.rows.length}</span> row{result.rows.length === 1 ? '' : 's'} ·{' '}
          <span className="text-neutral-500">{formatMs(ms)}</span>
          {result.rows.length > MAX_ROWS_SHOWN && (
            <span className="text-neutral-500"> · showing the first {MAX_ROWS_SHOWN}; downloads include all</span>
          )}
        </p>
        <div className="flex gap-2">
          <button
            className={secondaryButton}
            onClick={() => downloadText(resultsToCsv(result.vars, result.rows), 'query-results.csv', 'text/csv')}
          >
            Download CSV
          </button>
          <button
            className={secondaryButton}
            onClick={() => downloadText(result.json, 'query-results.json', 'application/sparql-results+json')}
          >
            Download JSON
          </button>
        </div>
      </div>

      {result.rows.length === 0 ? (
        <p className="text-sm text-neutral-600 bg-neutral-50 border border-[var(--loom-line)] rounded-md p-3">
          No results. The query ran, but nothing in the graph matched it.
        </p>
      ) : (
        <div className="overflow-auto max-h-[28rem] rounded-lg border border-[var(--loom-line)] bg-white">
          <table className="min-w-full text-xs">
            <caption className="sr-only">Query results</caption>
            <thead className="sticky top-0 bg-neutral-50">
              <tr>
                {result.vars.map((v) => (
                  <th key={v} scope="col" className="text-left font-mono font-medium px-3 py-2 border-b border-[var(--loom-line)]">
                    ?{v}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, i) => (
                <tr key={i} className="odd:bg-white even:bg-neutral-50/60">
                  {result.vars.map((v) => {
                    const term = row[v]
                    return (
                      <td
                        key={v}
                        title={termTitle(term, prefixes)}
                        className={`px-3 py-1.5 align-top border-b border-[var(--loom-line)] ${
                          term?.type === 'uri' ? 'font-mono text-[var(--loom-accent)]' : ''
                        }`}
                      >
                        {termLabel(term, prefixes)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
