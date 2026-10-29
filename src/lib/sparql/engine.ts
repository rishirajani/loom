import { classifyQuery } from './queryText'

// The engine is the only code that talks to Oxigraph. It takes the module as
// an argument so the same logic runs on the web build inside the worker and
// on the Node build in tests (both expose an identical Store API).

interface OxStore {
  readonly size: number
  load(input: string, options: { format: string }): void
  query(query: string, options?: { results_format?: string }): unknown
}
export interface OxigraphModule {
  Store: new () => OxStore
}

/** A term as it appears in SPARQL 1.1 JSON results. */
export interface ResultTerm {
  type: 'uri' | 'literal' | 'bnode' | 'triple'
  value: string
  datatype?: string
  'xml:lang'?: string
}

export type QueryResult =
  | { kind: 'select'; vars: string[]; rows: Record<string, ResultTerm>[]; json: string }
  | { kind: 'ask'; value: boolean }
  | { kind: 'graph'; ntriples: string; tripleCount: number }

/** Thrown for queries Loom refuses before they reach Oxigraph. */
export class RejectedQueryError extends Error {}

export function createEngine(ox: OxigraphModule) {
  let store: OxStore | null = null

  return {
    /** Replace the store's contents with the given Turtle. Returns the triple count. */
    load(turtle: string): number {
      const next = new ox.Store()
      next.load(turtle, { format: 'text/turtle' })
      store = next
      return next.size
    },

    run(query: string): QueryResult {
      if (!store) throw new Error('No graph is loaded yet.')
      const kind = classifyQuery(query)
      switch (kind) {
        case 'update':
          // query() would refuse this anyway, but with "expected CONSTRUCT".
          throw new RejectedQueryError(
            'This is a SPARQL update (INSERT, DELETE, …). The query view is read-only: ' +
              'it never changes your graph. Edit the mapping instead, or use SELECT, ASK, CONSTRUCT or DESCRIBE.',
          )
        case 'select': {
          const json = store.query(query, { results_format: 'json' }) as string
          const parsed = JSON.parse(json) as {
            head: { vars?: string[] }
            results: { bindings: Record<string, ResultTerm>[] }
          }
          return { kind, vars: parsed.head.vars ?? [], rows: parsed.results.bindings, json }
        }
        case 'ask': {
          const parsed = JSON.parse(store.query(query, { results_format: 'json' }) as string) as {
            boolean: boolean
          }
          return { kind, value: parsed.boolean }
        }
        case 'construct':
        case 'describe': {
          const ntriples = store.query(query, { results_format: 'application/n-triples' }) as string
          const tripleCount = ntriples.split('\n').filter((l) => l.trim() !== '').length
          return { kind: 'graph', ntriples, tripleCount }
        }
        default:
          // Not recognisably any query form: let Oxigraph produce the
          // positioned syntax error rather than guessing at one ourselves.
          store.query(query)
          throw new Error('Unrecognised query form.')
      }
    },
  }
}

export type Engine = ReturnType<typeof createEngine>
