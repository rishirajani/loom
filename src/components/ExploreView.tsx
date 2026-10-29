import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react'
import { QueryCancelledError, type SparqlClient } from '../lib/sparql/client'
import { compactIri } from '../lib/sparql/format'
import { displayLabel, layoutNeighbourhood, type Layout } from '../lib/explore/layout'
import {
  entityAtQuery,
  entityCountQuery,
  firstEntityQuery,
  labelPredicates,
  neighbourhoodQuery,
  parseCount,
  parseEntity,
  parseNeighbourhood,
  parseSearch,
  searchQuery,
  type EntityHit,
  type Neighbourhood,
} from '../lib/explore/neighbourhood'
import {
  announceFocus,
  announceSelection,
  describeEdge,
  focusOf,
  initialNav,
  keyToAction,
  navigate,
  predicateLabel,
  type NavAction,
  type NavState,
} from '../lib/explore/navigation'
import { resolvePrefixedIri } from '../lib/tripleGenerator'
import type { MappingConfig, Ontology } from '../lib/types'

interface Props {
  client: SparqlClient
  mapping: MappingConfig
  ontology: Ontology
  prefixes: Record<string, string>
}

type Loaded = { status: 'loading' } | { status: 'ready'; nb: Neighbourhood } | { status: 'error'; message: string }

function truncate(text: string, max = 24): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Run a query, retrying once if it was cancelled — the Query tab's Cancel
 * stops the shared engine, which would otherwise take an explorer request
 * down with it.
 */
async function runSelect(client: SparqlClient, query: string) {
  try {
    return (await client.run(query)).result
  } catch (e) {
    if (e instanceof QueryCancelledError) return (await client.run(query)).result
    throw e
  }
}

export function ExploreView({ client, mapping, ontology, prefixes }: Props) {
  const labels = useMemo(() => labelPredicates(mapping, ontology), [mapping, ontology])
  const typeIri = useMemo(() => resolvePrefixedIri(mapping.rdfType, ontology), [mapping.rdfType, ontology])
  const classLabel = ontology.classes.find((c) => c.id === mapping.rdfType)?.label ?? mapping.rdfType

  const [cache, setCache] = useState<Map<string, Loaded>>(new Map())
  const [startError, setStartError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const regionRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const helpId = useId()
  const searchListId = useId()
  // Lay out at the drawing's real width, so text stays readable on a phone
  // instead of a desktop-sized picture being scaled down.
  const [drawWidth, setDrawWidth] = useState(640)
  useEffect(() => {
    const el = regionRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      if (w > 0) setDrawWidth(Math.min(720, Math.max(300, w)))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const [nav, dispatchRaw] = useReducer(
    (state: NavState, { action, edges }: { action: NavAction; edges: Neighbourhood['edges'] }) =>
      navigate(state, action, edges),
    initialNav,
  )
  const focusIri = focusOf(nav)
  // Selection changes are spoken only when made with the explorer's own keys:
  // a connections-list button already announces itself when it gets focus.
  const speakSelection = useRef(false)
  const current = focusIri ? cache.get(focusIri) : undefined
  const nb = current?.status === 'ready' ? current.nb : undefined
  const edges = useMemo(() => nb?.edges ?? [], [nb])
  const dispatch = useCallback((action: NavAction) => dispatchRaw({ action, edges }), [edges])

  // Open on the first entity of the mapped class.
  useEffect(() => {
    let alive = true
    runSelect(client, firstEntityQuery(typeIri))
      .then((result) => {
        if (!alive) return
        const first = parseEntity(result)
        if (first) dispatchRaw({ action: { type: 'start', iri: first }, edges: [] })
        else setStartError(`The graph has no ${classLabel} entities to explore.`)
      })
      .catch((e: unknown) => alive && setStartError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [client, typeIri, classLabel])

  // Load the focus entity's neighbourhood the first time we arrive there.
  useEffect(() => {
    const iri = focusIri
    if (!iri || cache.has(iri)) return
    setCache((prev) => new Map(prev).set(iri, { status: 'loading' }))
    runSelect(client, neighbourhoodQuery(iri, labels))
      .then((result) => {
        setCache((prev) => new Map(prev).set(iri, { status: 'ready', nb: parseNeighbourhood(iri, result, labels) }))
      })
      .catch((e: unknown) => {
        setCache((prev) =>
          new Map(prev).set(iri, { status: 'error', message: e instanceof Error ? e.message : String(e) }),
        )
      })
  }, [client, labels, cache, focusIri])

  // Speak on arrival, and whenever the selection moves.
  useEffect(() => {
    if (nb) setAnnouncement(announceFocus(nb, prefixes, nav.trail.length > 1))
  }, [nb, prefixes, nav.trail.length])
  useEffect(() => {
    if (!speakSelection.current) return
    speakSelection.current = false
    if (nb && nav.selected !== null) setAnnouncement(announceSelection(nb, nav.selected, prefixes))
  }, [nb, nav.selected, prefixes])

  /** Navigate, then keep keyboard focus on the explorer so arrow keys keep working. */
  const goAndFocus = useCallback(
    (action: NavAction) => {
      dispatch(action)
      regionRef.current?.focus()
    },
    [dispatch],
  )

  function onRegionKeyDown(e: React.KeyboardEvent) {
    if (e.key === '/') {
      e.preventDefault()
      searchRef.current?.focus()
      return
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const action = keyToAction(e.key)
    if (!action) return
    e.preventDefault()
    speakSelection.current = true
    dispatch(action)
  }

  async function pickRandom() {
    try {
      const count = parseCount(await runSelect(client, entityCountQuery(typeIri)))
      if (count === 0) return
      let iri: string | undefined
      for (let attempt = 0; attempt < 3 && (!iri || iri === focusIri); attempt++) {
        iri = parseEntity(await runSelect(client, entityAtQuery(typeIri, Math.floor(Math.random() * count))))
        if (count === 1) break
      }
      if (iri) goAndFocus({ type: 'go', iri })
    } catch (e) {
      setAnnouncement(e instanceof Error ? e.message : String(e))
    }
  }

  if (startError) {
    return <p className="text-sm text-neutral-600 bg-neutral-50 border border-[var(--loom-line)] rounded-md p-3">{startError}</p>
  }

  const focusName = focusIri ? displayLabel(focusIri, nb?.label) : ''
  const drawHeight = Math.round(Math.min(460, Math.max(300, drawWidth * 0.72)))
  const layout = nb ? layoutNeighbourhood(nb, drawWidth, drawHeight) : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <EntitySearch
          inputRef={searchRef}
          listId={searchListId}
          client={client}
          labels={labels}
          onPick={(iri) => goAndFocus({ type: 'go', iri })}
        />
        <button
          type="button"
          onClick={() => void pickRandom()}
          className="rounded-full border border-[var(--loom-line)] px-4 py-2 text-xs font-medium hover:bg-neutral-50 transition-colors"
        >
          Random {classLabel}
        </button>
      </div>

      {nav.trail.length > 0 && (
        <nav aria-label="Path through the graph" className="text-xs">
          <ol className="flex flex-wrap items-center gap-1 text-neutral-500">
            {nav.trail.map((iri, i) => {
              const last = i === nav.trail.length - 1
              const loaded = cache.get(iri)
              const name = displayLabel(iri, loaded?.status === 'ready' ? loaded.nb.label : undefined)
              return (
                <li key={`${iri}-${i}`} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden="true">›</span>}
                  {last ? (
                    <span aria-current="location" className="font-medium text-[var(--loom-ink)]">
                      {name}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => goAndFocus({ type: 'backTo', index: i })}
                      className="underline decoration-dotted hover:text-[var(--loom-accent)]"
                    >
                      {name}
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-2">
          <div
            ref={regionRef}
            tabIndex={0}
            role="application"
            aria-roledescription="graph explorer"
            aria-label={focusName ? `Graph explorer, at ${focusName}` : 'Graph explorer'}
            aria-describedby={helpId}
            onKeyDown={onRegionKeyDown}
            className="rounded-lg border border-[var(--loom-line)] bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--loom-accent)]"
          >
            {current?.status === 'error' ? (
              <p className="p-6 text-sm text-red-800">{current.message}</p>
            ) : layout && nb ? (
              <GraphSvg
                layout={layout}
                focusName={focusName}
                selectedEdge={nav.selected !== null ? edges[nav.selected] : undefined}
                prefixes={prefixes}
                onFollow={(iri) => goAndFocus({ type: 'go', iri })}
              />
            ) : (
              <p className="p-6 text-sm text-neutral-500" role="status">
                Loading…
              </p>
            )}
          </div>
          <p id={helpId} className="text-xs text-neutral-500">
            Click the graph (or Tab to it), then: ←/→ move between links · Enter go there · Backspace back · /
            search · Esc clear.
          </p>
          {layout && layout.hiddenCount > 0 && (
            <p className="text-xs text-neutral-500">
              {layout.hiddenCount} more linked {layout.hiddenCount === 1 ? 'entity is' : 'entities are'} not drawn —
              they're all in the connections list.
            </p>
          )}
          {nb?.truncated && (
            <p className="text-xs text-amber-700">
              This entity has a very large number of links; only the first 2,000 are shown.
            </p>
          )}
        </div>

        {nb && (
          <aside className="space-y-4 text-sm">
            <section aria-label="Details" className="space-y-2">
              <h3 className="text-base font-semibold break-words">{focusName}</h3>
              <div className="flex flex-wrap gap-1">
                {nb.types.map((t) => (
                  <span key={t} className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs" title={t}>
                    {predicateLabel(t, prefixes)}
                  </span>
                ))}
              </div>
              <p className="font-mono text-xs text-neutral-500 break-all">{nb.iri}</p>
              {nb.literals.length > 0 && (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                  {nb.literals.map((l, i) => (
                    <div key={i} className="contents">
                      <dt className="text-neutral-500" title={l.predicate}>
                        {predicateLabel(l.predicate, prefixes)}
                      </dt>
                      <dd className="break-words">{l.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>

            <section aria-labelledby="connections-heading" className="space-y-2">
              <h3 id="connections-heading" className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Connections ({nb.edges.length})
              </h3>
              {nb.edges.length === 0 ? (
                <p className="text-xs text-neutral-500">No links to or from other entities.</p>
              ) : (
                <ol className="space-y-1 max-h-80 overflow-auto">
                  {nb.edges.map((edge, i) => (
                    <li key={edge.id}>
                      <button
                        type="button"
                        onClick={() => goAndFocus({ type: 'go', iri: edge.target })}
                        onFocus={() => dispatch({ type: 'select', index: i })}
                        aria-label={`Go to ${displayLabel(edge.target, edge.targetLabel)}: ${describeEdge(edge, focusName, prefixes)}`}
                        className={`w-full text-left rounded-md border px-2 py-1.5 text-xs transition-colors ${
                          nav.selected === i
                            ? 'border-[var(--loom-accent)] bg-[var(--loom-accent)]/10'
                            : 'border-transparent hover:bg-neutral-50'
                        }`}
                      >
                        <span className="text-neutral-500">
                          {edge.direction === 'out' ? '→' : '←'} {predicateLabel(edge.predicate, prefixes)}
                        </span>{' '}
                        <span className="font-medium">{displayLabel(edge.target, edge.targetLabel)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </aside>
        )}
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  )
}

function GraphSvg({
  layout,
  focusName,
  selectedEdge,
  prefixes,
  onFollow,
}: {
  layout: Layout
  focusName: string
  selectedEdge?: Neighbourhood['edges'][number]
  prefixes: Record<string, string>
  onFollow: (iri: string) => void
}) {
  // Smaller circles on a narrow drawing leave the lines long enough to read.
  const FOCUS_R = layout.width < 480 ? 20 : 30
  const NODE_R = layout.width < 480 ? 7 : 9
  return (
    // The connections list carries the same information as real, focusable
    // buttons, so the drawing itself is hidden from assistive technology.
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="w-full h-auto select-none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <marker id="loom-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
        </marker>
      </defs>
      {layout.neighbours.map((n) => {
        const selected = !!selectedEdge && selectedEdge.target === n.target
        const hasOut = n.edges.some((e) => e.direction === 'out')
        const hasIn = n.edges.some((e) => e.direction === 'in')
        // Stop lines at the circles' edges so arrowheads stay visible.
        const dx = n.x - layout.cx
        const dy = n.y - layout.cy
        const len = Math.hypot(dx, dy) || 1
        const x1 = layout.cx + (dx / len) * (FOCUS_R + 2)
        const y1 = layout.cy + (dy / len) * (FOCUS_R + 2)
        const x2 = n.x - (dx / len) * (NODE_R + 2)
        const y2 = n.y - (dy / len) * (NODE_R + 2)
        // Edge labels sit nearer the neighbour than the focus, where lines
        // are further apart.
        const mx = layout.cx + dx * 0.62
        const my = layout.cy + dy * 0.62
        const cos = Math.cos(n.angle)
        const anchor = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle'
        const lx = n.x + (anchor === 'start' ? 14 : anchor === 'end' ? -14 : 0)
        const ly = n.y + (anchor === 'middle' ? (Math.sin(n.angle) > 0 ? 24 : -16) : 4)
        const predicates = [...new Set(n.edges.map((e) => predicateLabel(e.predicate, prefixes)))].join(', ')
        return (
          <g
            key={n.target}
            className={selected ? 'text-[var(--loom-accent)]' : 'text-neutral-400'}
            style={{ cursor: 'pointer' }}
            onClick={() => onFollow(n.target)}
          >
            <title>{`${n.label} — ${predicates}`}</title>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="currentColor"
              strokeWidth={selected ? 2.5 : 1.25}
              markerEnd={hasOut ? 'url(#loom-arrow)' : undefined}
              markerStart={hasIn ? 'url(#loom-arrow)' : undefined}
            />
            {(!layout.sharedPredicate || selected) && (
              <text
                x={mx}
                y={my - 4}
                textAnchor="middle"
                fontSize="10"
                className={selected ? 'fill-[var(--loom-accent)]' : 'fill-neutral-500'}
                stroke="white"
                strokeWidth="3"
                paintOrder="stroke"
              >
                {truncate(predicates, 22)}
              </text>
            )}
            <circle
              cx={n.x}
              cy={n.y}
              r={selected ? NODE_R + 2 : NODE_R}
              className={selected ? 'fill-[var(--loom-accent)]' : 'fill-[var(--loom-thread-light)]'}
              stroke="white"
              strokeWidth="2"
            />
            <text
              x={lx}
              y={ly}
              textAnchor={anchor}
              fontSize="12"
              className={selected ? 'fill-[var(--loom-ink)] font-semibold' : 'fill-[var(--loom-ink)]'}
              stroke="white"
              strokeWidth="3"
              paintOrder="stroke"
            >
              {truncate(n.label, layout.labelChars)}
            </text>
          </g>
        )
      })}
      <circle cx={layout.cx} cy={layout.cy} r={FOCUS_R} className="fill-[var(--loom-ink)]" />
      <text
        x={layout.cx}
        y={layout.cy + FOCUS_R + 18}
        textAnchor="middle"
        fontSize="13"
        className="fill-[var(--loom-ink)] font-semibold"
        stroke="white"
        strokeWidth="5"
        paintOrder="stroke"
      >
        {truncate(focusName, 30)}
      </text>
      {layout.sharedPredicate && (
        <text x={12} y={layout.height - 12} fontSize="11" className="fill-neutral-500">
          {layout.neighbours.length === 1 ? 'Link' : 'All links'}: {predicateLabel(layout.sharedPredicate, prefixes)}{' '}
          (arrows show direction)
        </text>
      )}
      {layout.neighbours.length === 0 && (
        <text x={layout.cx} y={layout.cy + FOCUS_R + 40} textAnchor="middle" fontSize="11" className="fill-neutral-500">
          No links to other entities
        </text>
      )}
    </svg>
  )
}

function EntitySearch({
  inputRef,
  listId,
  client,
  labels,
  onPick,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  listId: string
  client: SparqlClient
  labels: string[]
  onPick: (iri: string) => void
}) {
  const [text, setText] = useState('')
  const [hits, setHits] = useState<EntityHit[] | null>(null)
  const [active, setActive] = useState(-1)
  const seq = useRef(0)

  useEffect(() => {
    const q = text.trim()
    if (q.length < 2) {
      setHits(null)
      return
    }
    const mine = ++seq.current
    const timer = setTimeout(() => {
      runSelect(client, searchQuery(q, labels))
        .then((result) => {
          if (mine === seq.current) {
            setHits(parseSearch(result))
            setActive(-1)
          }
        })
        .catch(() => mine === seq.current && setHits([]))
    }, 150)
    return () => clearTimeout(timer)
  }, [text, client, labels])

  function pick(hit: EntityHit) {
    setText('')
    setHits(null)
    onPick(hit.iri)
  }

  const open = hits !== null
  return (
    <div className="relative flex-1 min-w-[14rem]">
      <label className="sr-only" htmlFor={`${listId}-input`}>
        Find an entity by name
      </label>
      <input
        id={`${listId}-input`}
        ref={inputRef}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (!hits?.length) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => (a + 1) % hits.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => (a - 1 + hits.length) % hits.length)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            pick(hits[active >= 0 ? active : 0])
          } else if (e.key === 'Escape') {
            setHits(null)
          }
        }}
        placeholder="Find an entity by name…"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        className="w-full rounded-full border border-[var(--loom-line)] bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--loom-accent)]"
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching entities"
          className="absolute z-10 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-[var(--loom-line)] bg-white shadow-sm text-sm"
        >
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-xs text-neutral-500" role="option" aria-selected="false" aria-disabled="true">
              No matches
            </li>
          ) : (
            hits.map((hit, i) => (
              <li
                key={hit.iri}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(hit)}
                className={`cursor-pointer px-3 py-2 ${i === active ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
              >
                <span className="font-medium">{displayLabel(hit.iri, hit.label)}</span>{' '}
                <span className="font-mono text-xs text-neutral-400">{compactIri(hit.iri, {})}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
