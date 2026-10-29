import { describe, expect, it } from 'vitest'
import { QueryCancelledError, QueryError, SparqlClient, type WorkerLike } from '../sparql/client'
import { compactIri, resultsToCsv, termLabel, termTitle } from '../sparql/format'
import type { FromWorker, ToWorker } from '../sparql/protocol'

/** A worker double whose replies the test sends by hand. */
class FakeWorker implements WorkerLike {
  received: ToWorker[] = []
  terminated = false
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage(message: ToWorker) {
    this.received.push(message)
  }
  terminate() {
    this.terminated = true
  }
  reply(message: FromWorker) {
    this.onmessage?.({ data: message } as MessageEvent<FromWorker>)
  }
  lastRunId(): number {
    const run = [...this.received].reverse().find((m) => m.type === 'run')
    if (!run || run.type !== 'run') throw new Error('no run message')
    return run.id
  }
}

function setup() {
  const workers: FakeWorker[] = []
  const client = new SparqlClient('<a:s> <a:p> "o" .', { schema: 'https://schema.org/' }, () => {
    const w = new FakeWorker()
    workers.push(w)
    return w
  })
  return { client, workers }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('SparqlClient', () => {
  it('loads the graph once and runs queries against it', async () => {
    const { client, workers } = setup()
    const loaded = client.load()
    expect(workers[0].received[0]).toEqual({ type: 'load', turtle: '<a:s> <a:p> "o" .' })
    workers[0].reply({ type: 'loaded', tripleCount: 1, ms: 1 })
    expect(await loaded).toBe(1)

    const running = client.run('ASK {}')
    await tick()
    workers[0].reply({ type: 'result', id: workers[0].lastRunId(), result: { kind: 'ask', value: true }, ms: 2 })
    expect(await running).toEqual({ result: { kind: 'ask', value: true }, ms: 2 })
    expect(workers).toHaveLength(1)
  })

  it('cancel stops the worker, and the next query restarts it with the same graph', async () => {
    const { client, workers } = setup()
    const loaded = client.load()
    workers[0].reply({ type: 'loaded', tripleCount: 1, ms: 1 })
    await loaded

    const runaway = client.run('SELECT * { ?a ?b ?c . ?d ?e ?f }')
    await tick()
    expect(client.busy).toBe(true)
    client.cancel()
    await expect(runaway).rejects.toBeInstanceOf(QueryCancelledError)
    expect(workers[0].terminated).toBe(true)
    expect(client.busy).toBe(false)

    const next = client.run('ASK {}')
    expect(workers).toHaveLength(2)
    expect(workers[1].received[0]).toEqual({ type: 'load', turtle: '<a:s> <a:p> "o" .' })
    workers[1].reply({ type: 'loaded', tripleCount: 1, ms: 1 })
    await tick()
    workers[1].reply({ type: 'result', id: workers[1].lastRunId(), result: { kind: 'ask', value: false }, ms: 1 })
    expect((await next).result).toEqual({ kind: 'ask', value: false })
  })

  it('cancel during loading releases callers instead of leaving them hanging', async () => {
    const { client } = setup()
    const running = client.run('ASK {}') // waits on load, which never answers
    client.cancel()
    await expect(running).rejects.toBeInstanceOf(QueryCancelledError)
  })

  it('a reply from a cancelled run is ignored', async () => {
    const { client, workers } = setup()
    const loaded = client.load()
    workers[0].reply({ type: 'loaded', tripleCount: 1, ms: 1 })
    await loaded
    const first = client.run('ASK {}')
    await tick()
    const id = workers[0].lastRunId()
    client.cancel()
    await expect(first).rejects.toBeInstanceOf(QueryCancelledError)
    expect(() =>
      workers[0].reply({ type: 'result', id, result: { kind: 'ask', value: true }, ms: 1 }),
    ).not.toThrow()
  })

  it('maps engine errors to friendly messages, and passes Loom refusals through as written', async () => {
    const { client, workers } = setup()
    const loaded = client.load()
    workers[0].reply({ type: 'loaded', tripleCount: 1, ms: 1 })
    await loaded

    const bad = client.run('SELECT ?n WHERE { ?s schema:name ?n }')
    await tick()
    workers[0].reply({
      type: 'error',
      id: workers[0].lastRunId(),
      message: "error at 1:31: expected one of Prefix not found, ['%'], ['-' | '0' ..= '9']",
      rejected: false,
    })
    const err = await bad.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(QueryError)
    expect((err as QueryError).detail.message).toMatch(/Unknown prefix schema:/)
    expect((err as QueryError).detail.fixPrefixes).toEqual(['PREFIX schema: <https://schema.org/>'])

    const update = client.run('DELETE WHERE { ?s ?p ?o }')
    await tick()
    workers[0].reply({ type: 'error', id: workers[0].lastRunId(), message: 'The query view is read-only.', rejected: true })
    const err2 = await update.catch((e: unknown) => e)
    expect((err2 as QueryError).detail).toEqual({ message: 'The query view is read-only.' })
  })

  it('reports a failed load and lets a later attempt retry', async () => {
    const { client, workers } = setup()
    const first = client.load()
    workers[0].reply({ type: 'error', message: 'bad turtle', rejected: false })
    await expect(first).rejects.toThrow(/could not be loaded.*bad turtle/)
    const second = client.load()
    expect(workers).toHaveLength(2)
    workers[1].reply({ type: 'loaded', tripleCount: 1, ms: 1 })
    expect(await second).toBe(1)
  })
})

describe('result formatting', () => {
  const prefixes = { schema: 'https://schema.org/', xsd: 'http://www.w3.org/2001/XMLSchema#' }

  it('compacts IRIs with the longest matching namespace, and only to valid local names', () => {
    expect(compactIri('https://schema.org/name', prefixes)).toBe('schema:name')
    expect(compactIri('https://example.org/people/1', prefixes)).toBe('<https://example.org/people/1>')
    expect(compactIri('https://schema.org/a/b', prefixes)).toBe('<https://schema.org/a/b>')
  })

  it('labels cells by value and keeps datatype or full IRI for the tooltip', () => {
    const date = { type: 'literal' as const, value: '2020-01-01', datatype: `${prefixes.xsd}date` }
    expect(termLabel(date, prefixes)).toBe('2020-01-01')
    expect(termTitle(date, prefixes)).toBe('"2020-01-01"^^xsd:date')
    const iri = { type: 'uri' as const, value: 'https://schema.org/Person' }
    expect(termLabel(iri, prefixes)).toBe('schema:Person')
    expect(termTitle(iri, prefixes)).toBe('https://schema.org/Person')
    expect(termLabel(undefined, prefixes)).toBe('')
  })

  it('writes SPARQL results CSV with quoting and empty cells for unbound variables', () => {
    const csv = resultsToCsv(
      ['name', 'note'],
      [
        { name: { type: 'literal', value: 'Lovelace, Ada' }, note: { type: 'literal', value: 'said "hi"' } },
        { name: { type: 'uri', value: 'https://example.org/1' } },
      ],
    )
    expect(csv).toBe('name,note\r\n"Lovelace, Ada","said ""hi"""\r\nhttps://example.org/1,\r\n')
  })
})
