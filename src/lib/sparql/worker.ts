// Module worker hosting Oxigraph. Queries run here, off the main thread, for
// two reasons: a heavy query must not freeze the page, and Oxigraph's query()
// is synchronous with no timeout — terminating this worker is the only way to
// stop a runaway query, which is what the Cancel button does.
//
// Oxigraph's JS build is single-threaded, so this needs no cross-origin
// isolation (COOP/COEP) and runs on GitHub Pages' default headers.
import init, * as oxigraph from 'oxigraph/web.js'
// Explicit asset URL rather than the package's own new URL(..., import.meta.url)
// lookup, so the WASM path never depends on how a bundler rewrites the package.
import wasmUrl from 'oxigraph/web_bg.wasm?url'
import { createEngine, RejectedQueryError } from './engine'
import type { FromWorker, ToWorker } from './protocol'

const ctx = self as unknown as {
  postMessage(message: FromWorker): void
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null
}

const ready = init({ module_or_path: wasmUrl })
const engine = createEngine(oxigraph)

ctx.onmessage = async (event) => {
  const msg = event.data
  const id = msg.type === 'run' ? msg.id : undefined
  try {
    await ready
    const start = performance.now()
    if (msg.type === 'load') {
      const tripleCount = engine.load(msg.turtle)
      ctx.postMessage({ type: 'loaded', tripleCount, ms: performance.now() - start })
    } else {
      const result = engine.run(msg.query)
      ctx.postMessage({ type: 'result', id: msg.id, result, ms: performance.now() - start })
    }
  } catch (e) {
    ctx.postMessage({
      type: 'error',
      id,
      message: e instanceof Error ? e.message : String(e),
      rejected: e instanceof RejectedQueryError,
    })
  }
}
