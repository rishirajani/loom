import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
// The Node build of Oxigraph has the same Store API as the web build the
// worker uses, so the engine logic is tested against the real query engine.
import * as oxigraph from 'oxigraph'
import { createEngine, RejectedQueryError, type QueryResult } from '../sparql/engine'
import { friendlyError } from '../sparql/errors'
import { ntriplesToTurtle } from '../sparql/format'
import { prefixBlock, starterQueries } from '../sparql/starterQueries'
import { dcatOntology, schemaOrgOntology } from '../ontologies'
import { generateTriples, graphPrefixes, quadsToTurtle } from '../tripleGenerator'
import type { MappingConfig, Ontology, ParsedTable } from '../types'

function tableFromCsv(text: string): ParsedTable {
  const [head, ...lines] = text.trim().split(/\r?\n/)
  const headers = head.split(',')
  const rows = lines.map((line) => {
    const cells = line.split(',')
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']))
  })
  return { headers, rows, sampleValues: {} }
}

const peopleMapping: MappingConfig = {
  baseIri: 'https://example.org/people/',
  ontologyId: 'schema-org',
  rdfType: 'schema:Person',
  identifierColumn: 'employee_id',
  columns: [
    { column: 'employee_id', kind: 'skip' },
    { column: 'name', kind: 'literal', predicate: 'schema:name', datatype: 'xsd:string' },
    { column: 'email', kind: 'literal', predicate: 'schema:email', datatype: 'xsd:string' },
    { column: 'job_title', kind: 'literal', predicate: 'schema:jobTitle', datatype: 'xsd:string' },
    { column: 'hire_date', kind: 'skip' },
    { column: 'manager_id', kind: 'objectRef', predicate: 'schema:colleague' },
  ],
}

async function engineFor(table: ParsedTable, mapping: MappingConfig, ontology: Ontology) {
  const { quads } = generateTriples(table, mapping, ontology)
  const turtle = await quadsToTurtle(quads, ontology)
  const engine = createEngine(oxigraph)
  const size = engine.load(turtle)
  return { engine, size, tripleCount: quads.length }
}

function select(result: QueryResult) {
  if (result.kind !== 'select') throw new Error(`expected select, got ${result.kind}`)
  return result
}

describe('query engine over the sample CSV', () => {
  const table = tableFromCsv(readFileSync('public/examples/sample-people.csv', 'utf8'))
  let engine: Awaited<ReturnType<typeof engineFor>>['engine']

  beforeAll(async () => {
    const built = await engineFor(table, peopleMapping, schemaOrgOntology)
    engine = built.engine
    // What the user queries is exactly what they download.
    expect(built.size).toBe(built.tripleCount)
  })

  it('answers a SELECT with variables in the order written', () => {
    const r = select(
      engine.run(`${prefixBlock(schemaOrgOntology)}
SELECT ?name ?entity WHERE { ?entity schema:name ?name } ORDER BY ?name`),
    )
    expect(r.vars).toEqual(['name', 'entity'])
    expect(r.rows.map((row) => row.name.value)).toEqual(table.rows.map((row) => row.name).sort())
    expect(r.rows[0].entity.type).toBe('uri')
    expect(JSON.parse(r.json).head.vars).toEqual(['name', 'entity'])
  })

  it('answers ASK with a boolean', () => {
    const p = prefixBlock(schemaOrgOntology)
    expect(engine.run(`${p}\nASK { ?s schema:name "Ada Lovelace" }`)).toEqual({ kind: 'ask', value: true })
    expect(engine.run(`${p}\nASK { ?s schema:name "Nobody" }`)).toEqual({ kind: 'ask', value: false })
  })

  it('returns CONSTRUCT results as N-Triples that re-serialize to prefixed Turtle', async () => {
    const r = engine.run(`${prefixBlock(schemaOrgOntology)}
CONSTRUCT { ?s schema:name ?n } WHERE { ?s schema:name ?n }`)
    expect(r.kind).toBe('graph')
    if (r.kind !== 'graph') return
    expect(r.tripleCount).toBe(table.rows.length)
    const turtle = await ntriplesToTurtle(r.ntriples, graphPrefixes(schemaOrgOntology))
    expect(turtle).toContain('@prefix schema: <https://schema.org/>')
    expect(turtle).toContain('schema:name "Ada Lovelace"')
  })

  // Pinned decision: the query view is read-only. Oxigraph's query() refuses
  // updates too, but its message ("expected CONSTRUCT") explains nothing.
  it('refuses updates with a read-only explanation, and the graph is unchanged', () => {
    const p = prefixBlock(schemaOrgOntology)
    expect(() => engine.run(`${p}\nDELETE WHERE { ?s schema:name ?n }`)).toThrow(RejectedQueryError)
    expect(() => engine.run(`${p}\nDELETE WHERE { ?s schema:name ?n }`)).toThrow(/read-only/)
    const r = select(engine.run(`${p}\nSELECT (COUNT(*) AS ?n) WHERE { ?s schema:name ?o }`))
    expect(Number(r.rows[0].n.value)).toBe(table.rows.length)
  })

  it('turns an undeclared prefix into a readable message naming it', () => {
    const query = 'SELECT ?n WHERE { ?s schema:name ?n }'
    let raw = ''
    try {
      engine.run(query)
    } catch (e) {
      raw = String(e)
    }
    // Oxigraph's own message is hundreds of characters of Unicode ranges.
    expect(raw).toContain('Prefix not found')
    const friendly = friendlyError(raw, query)
    expect(friendly.message).toMatch(/Unknown prefix schema:/)
    expect(`${friendly.message} ${friendly.hint}`).not.toMatch(/\\u\{|\.\.=/)
    expect(friendly.hint).toContain('PREFIX schema:')
    // Unknown to Loom: no one-click fix, just an example.
    expect(friendly.fixPrefixes).toBeUndefined()

    // Known to Loom (one of the graph's prefixes): the exact line is offered.
    const known = friendlyError(raw, query, graphPrefixes(schemaOrgOntology))
    expect(known.fixPrefixes).toEqual(['PREFIX schema: <https://schema.org/>'])
    // Applying the fix makes the query run.
    expect(() => engine.run(`${known.fixPrefixes!.join('\n')}\n${query}`)).not.toThrow()
  })

  // Oxigraph reports where its parser gave up, which can be a line *after* the
  // mistake (here the broken FILTER is on line 7; it reports line 8). Loom
  // therefore says "near line N" and never points a caret at a character.
  it('reports a syntax error as "near" the parser position, with a short hint', () => {
    const query = `${prefixBlock(schemaOrgOntology)}\nSELECT ?x WHERE {\n  ?x ?p ?y\n  FILTER(?y > )\n}`
    let raw = ''
    try {
      engine.run(query)
    } catch (e) {
      raw = String(e)
    }
    const friendly = friendlyError(raw, query)
    expect(friendly.line).toBe(8)
    expect(friendly.message).toMatch(/couldn't be parsed near line 8/)
    expect(friendly.hint).toMatch(/^The parser expected one of: /)
    expect(friendly.hint!.length).toBeLessThan(120)
  })

  it('gives a keyword hint for a typo in a clause', () => {
    const query = 'SELECT ?x WHERE { ?x ?p ?y } LIMT 1'
    let raw = ''
    try {
      engine.run(query)
    } catch (e) {
      raw = String(e)
    }
    const friendly = friendlyError(raw, query)
    expect(friendly.hint).toMatch(/OFFSET/)
  })

  describe('starter queries', () => {
    const starters = starterQueries(peopleMapping, schemaOrgOntology)

    it.each(starters.map((s) => [s.id, s] as const))('%s runs without error', (_id, starter) => {
      expect(() => engine.run(starter.query)).not.toThrow()
    })

    it('the table query has one column per mapped literal property, labelled by name', () => {
      const r = select(engine.run(starters.find((s) => s.id === 'table')!.query))
      expect(r.vars).toEqual(['entity', 'name', 'email', 'jobTitle'])
      expect(r.rows).toHaveLength(table.rows.length)
      expect(r.rows.map((row) => row.name.value)).toEqual([...table.rows.map((row) => row.name)].sort())
    })

    it('the follow query resolves each reference to a labelled target', () => {
      const r = select(engine.run(starters.find((s) => s.id === 'follow-colleague')!.query))
      const expected = table.rows.filter((row) => row.manager_id).length
      expect(r.rows).toHaveLength(expected)
      for (const row of r.rows) expect(row.targetLabel?.value).toBeTruthy()
    })

    it('the ASK check reports no missing names in the sample', () => {
      expect(engine.run(starters.find((s) => s.id === 'missing-label')!.query)).toEqual({ kind: 'ask', value: false })
    })

    it('the CONSTRUCT starter returns the triples of exactly one entity', () => {
      const r = engine.run(starters.find((s) => s.id === 'one-entity')!.query)
      expect(r.kind).toBe('graph')
      if (r.kind !== 'graph') return
      const subjects = new Set(r.ntriples.trim().split('\n').map((l) => l.split(' ')[0]))
      expect(subjects.size).toBe(1)
    })
  })
})

describe('starter queries for other mappings', () => {
  it('run against a DCAT mapping that uses dct: properties and has no object references', async () => {
    const table: ParsedTable = {
      headers: ['id', 'title', 'keyword', 'issued'],
      rows: [
        { id: 'ds-1', title: 'Air quality', keyword: 'environment', issued: '2024-01-02' },
        { id: 'ds-2', title: '', keyword: 'transport', issued: '2023-06-30' },
      ],
      sampleValues: {},
    }
    const mapping: MappingConfig = {
      baseIri: 'https://example.org/datasets/',
      ontologyId: 'dcat',
      rdfType: 'dcat:Dataset',
      identifierColumn: 'id',
      columns: [
        { column: 'id', kind: 'skip' },
        { column: 'title', kind: 'literal', predicate: 'dct:title', datatype: 'xsd:string' },
        { column: 'keyword', kind: 'literal', predicate: 'dcat:keyword', datatype: 'xsd:string' },
        { column: 'issued', kind: 'literal', predicate: 'dct:issued', datatype: 'xsd:date' },
      ],
    }
    const { engine } = await engineFor(table, mapping, dcatOntology)
    const starters = starterQueries(mapping, dcatOntology)
    expect(starters.some((s) => s.id.startsWith('follow-'))).toBe(false)
    for (const s of starters) expect(() => engine.run(s.query), s.id).not.toThrow()
    // ds-2 has an empty title, so it has no dct:title triple: the ASK finds it.
    expect(engine.run(starters.find((s) => s.id === 'missing-label')!.query)).toEqual({ kind: 'ask', value: true })
  })

  it('still produce valid queries when nothing but the identifier is mapped', async () => {
    const table: ParsedTable = { headers: ['id'], rows: [{ id: '1' }, { id: '2' }], sampleValues: {} }
    const mapping: MappingConfig = {
      baseIri: 'https://example.org/x/',
      ontologyId: 'schema-org',
      rdfType: 'schema:Place',
      identifierColumn: 'id',
      columns: [{ column: 'id', kind: 'skip' }],
    }
    const { engine } = await engineFor(table, mapping, schemaOrgOntology)
    const starters = starterQueries(mapping, schemaOrgOntology)
    for (const s of starters) expect(() => engine.run(s.query), s.id).not.toThrow()
    const r = select(engine.run(starters.find((s) => s.id === 'table')!.query))
    expect(r.rows).toHaveLength(2)
  })
})
