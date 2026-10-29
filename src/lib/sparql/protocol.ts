import type { QueryResult } from './engine'

/** Messages from the page to the query worker. */
export type ToWorker =
  | { type: 'load'; turtle: string }
  | { type: 'run'; id: number; query: string }

/** Messages from the query worker back to the page. */
export type FromWorker =
  | { type: 'loaded'; tripleCount: number; ms: number }
  | { type: 'result'; id: number; result: QueryResult; ms: number }
  /** `rejected`: Loom refused the query itself; otherwise Oxigraph raised it. */
  | { type: 'error'; id?: number; message: string; rejected: boolean }
