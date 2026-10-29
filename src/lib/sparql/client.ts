import type { QueryResult } from './engine'
import { friendlyError, type FriendlyError } from './errors'
import type { FromWorker, ToWorker } from './protocol'

export class QueryError extends Error {
  readonly detail: FriendlyError
  constructor(detail: FriendlyError) {
    super(detail.message)
    this.detail = detail
  }
}

export class QueryCancelledError extends Error {
  constructor() {
    super('Query cancelled.')
  }
}

export interface WorkerLike {
  postMessage(message: ToWorker): void
  terminate(): void
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

interface Pending {
  query: string
  resolve: (r: { result: QueryResult; ms: number }) => void
  reject: (e: Error) => void
}

function defaultWorker(): WorkerLike {
  // Kept as a literal `new Worker(new URL(...))` so Vite detects and bundles it.
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as WorkerLike
}

/**
 * Page-side handle on the query worker. Holds the graph's Turtle so that after
 * a cancel (which kills the worker and everything in it) the next query can
 * transparently start a fresh worker and reload the same graph.
 */
export class SparqlClient {
  private worker: WorkerLike | null = null
  private loaded: Promise<number> | null = null
  private abortLoad: (() => void) | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private turtle: string
  private readonly knownPrefixes: Record<string, string>
  private readonly makeWorker: () => WorkerLike

  /**
   * @param knownPrefixes the graph's own prefixes, so an error about an
   *   undeclared one can offer the exact PREFIX line as a fix
   */
  constructor(turtle: string, knownPrefixes: Record<string, string> = {}, makeWorker: () => WorkerLike = defaultWorker) {
    this.turtle = turtle
    this.knownPrefixes = knownPrefixes
    this.makeWorker = makeWorker
  }

  /** Start the engine and load the graph. Resolves with the triple count. */
  load(): Promise<number> {
    if (this.loaded) return this.loaded
    const worker = this.makeWorker()
    this.worker = worker
    this.loaded = new Promise<number>((resolve, reject) => {
      // If the worker is cancelled before it finishes loading, anyone awaiting
      // load() must be released rather than left hanging.
      this.abortLoad = () => reject(new QueryCancelledError())
      worker.onmessage = (event) => {
        const msg = event.data
        if (msg.type === 'loaded') {
          this.abortLoad = null
          resolve(msg.tripleCount)
        }
        else if (msg.type === 'result') this.settle(msg.id, (p) => p.resolve({ result: msg.result, ms: msg.ms }))
        else if (msg.type === 'error') {
          if (msg.id === undefined) {
            reject(new Error(`The graph could not be loaded into the query engine: ${msg.message}`))
          } else {
            this.settle(msg.id, (p) =>
              p.reject(new QueryError(msg.rejected ? { message: msg.message } : friendlyError(msg.message, p.query, this.knownPrefixes))),
            )
          }
        }
      }
      worker.onerror = (event) => {
        const err = new Error(
          `The query engine failed to start${event.message ? `: ${event.message}` : ''}. Try reloading the page.`,
        )
        reject(err)
        this.failAll(err)
        this.reset()
      }
    })
    worker.postMessage({ type: 'load', turtle: this.turtle })
    // A failed start shouldn't be cached forever: let the next call retry.
    // (Only if this attempt is still the current one — a cancel may already
    // have replaced it.)
    const attempt = this.loaded
    attempt.catch(() => {
      if (this.loaded === attempt) this.reset()
    })
    return attempt
  }

  async run(query: string): Promise<{ result: QueryResult; ms: number }> {
    await this.load()
    const worker = this.worker
    if (!worker) throw new QueryCancelledError()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { query, resolve, reject })
      worker.postMessage({ type: 'run', id, query })
    })
  }

  /** Stop whatever is running. The next run() restarts the engine. */
  cancel(): void {
    this.failAll(new QueryCancelledError())
    this.reset()
  }

  dispose(): void {
    this.cancel()
  }

  get busy(): boolean {
    return this.pending.size > 0
  }

  private settle(id: number, f: (p: Pending) => void) {
    const p = this.pending.get(id)
    if (!p) return // cancelled meanwhile
    this.pending.delete(id)
    f(p)
  }

  private failAll(err: Error) {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  private reset() {
    this.worker?.terminate()
    this.worker = null
    this.loaded = null
    const abort = this.abortLoad
    this.abortLoad = null
    abort?.()
  }
}
