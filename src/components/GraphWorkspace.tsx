import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { QueryCancelledError, SparqlClient } from '../lib/sparql/client'
import { graphPrefixes } from '../lib/tripleGenerator'
import type { MappingConfig, Ontology } from '../lib/types'
import { ExploreView } from './ExploreView'
import { QueryView } from './QueryView'

export type WorkspaceTab = 'query' | 'explore'

interface Props {
  turtle: string
  mapping: MappingConfig
  ontology: Ontology
  initialTab: WorkspaceTab
  onBack: () => void
  onStartOver: () => void
}

type EngineState =
  | { status: 'loading' }
  | { status: 'ready'; tripleCount: number }
  | { status: 'failed'; message: string }

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'query', label: 'Query' },
  { id: 'explore', label: 'Explore' },
]

/**
 * Query and Explore over one graph, sharing one query engine: the WebAssembly
 * engine downloads and loads the graph once, whichever tab is opened first.
 * Both panels stay mounted after their first visit, so switching tabs keeps
 * the query text, results and the explorer's position.
 */
export function GraphWorkspace({ turtle, mapping, ontology, initialTab, onBack, onStartOver }: Props) {
  const prefixes = useMemo(() => graphPrefixes(ontology), [ontology])
  const [client, setClient] = useState<SparqlClient | null>(null)
  const [engine, setEngine] = useState<EngineState>({ status: 'loading' })
  const [tab, setTab] = useState<WorkspaceTab>(initialTab)
  const [visited, setVisited] = useState<Set<WorkspaceTab>>(new Set([initialTab]))
  const tabRefs = useRef<Record<WorkspaceTab, HTMLButtonElement | null>>({ query: null, explore: null })
  const baseId = useId()

  // One engine per graph, created when this view opens, so the 1.5 MB engine
  // is only downloaded by people who query or explore.
  useEffect(() => {
    const next = new SparqlClient(turtle, prefixes)
    setClient(next)
    setEngine({ status: 'loading' })
    let alive = true
    next
      .load()
      .then((tripleCount) => alive && setEngine({ status: 'ready', tripleCount }))
      .catch((e: unknown) => {
        if (!alive || e instanceof QueryCancelledError) return
        setEngine({ status: 'failed', message: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      alive = false
      next.dispose()
    }
  }, [turtle, prefixes])

  function select(next: WorkspaceTab, moveFocus = false) {
    setTab(next)
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)))
    if (moveFocus) tabRefs.current[next]?.focus()
  }

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Your graph</h2>
        <p className="text-sm text-neutral-600" aria-live="polite">
          {engine.status === 'loading' && 'Starting the query engine… (about 1.5 MB, downloaded once)'}
          {engine.status === 'ready' &&
            `${engine.tripleCount} triples loaded. Everything runs locally in this tab — nothing is sent anywhere.`}
          {engine.status === 'failed' && <span className="text-red-700">{engine.message}</span>}
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Work with your graph"
        className="flex gap-1 border-b border-[var(--loom-line)]"
        onKeyDown={(e) => {
          // ARIA tabs pattern: arrow keys move between tabs.
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          const i = TABS.findIndex((t) => t.id === tab)
          const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
          select(next.id, true)
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el
            }}
            id={`${baseId}-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`${baseId}-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => select(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-[var(--loom-accent)] text-[var(--loom-ink)]'
                : 'border-transparent text-neutral-500 hover:text-[var(--loom-ink)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {client &&
        TABS.map((t) =>
          visited.has(t.id) ? (
            <div
              key={t.id}
              id={`${baseId}-panel-${t.id}`}
              role="tabpanel"
              aria-labelledby={`${baseId}-tab-${t.id}`}
              hidden={tab !== t.id}
            >
              {t.id === 'query' ? (
                <QueryView
                  client={client}
                  engineFailed={engine.status === 'failed'}
                  mapping={mapping}
                  ontology={ontology}
                  prefixes={prefixes}
                />
              ) : engine.status === 'failed' ? null : (
                <ExploreView client={client} mapping={mapping} ontology={ontology} prefixes={prefixes} />
              )}
            </div>
          ) : null,
        )}

      <div className="flex gap-3 border-t border-[var(--loom-line)] pt-6">
        <button
          onClick={onBack}
          className="rounded-full border border-[var(--loom-line)] px-6 py-2 text-sm font-medium hover:bg-[var(--loom-hover)] hover:border-[var(--loom-thread-light)] transition-colors"
        >
          Back to results
        </button>
        <button
          onClick={onStartOver}
          className="rounded-full border border-[var(--loom-line)] px-6 py-2 text-sm font-medium hover:bg-[var(--loom-hover)] hover:border-[var(--loom-thread-light)] transition-colors"
        >
          Start over
        </button>
      </div>
    </div>
  )
}
