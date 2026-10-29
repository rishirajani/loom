import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import * as oxigraph from 'oxigraph'
import { createEngine, type Engine } from '../sparql/engine'
import { generateTriples, graphPrefixes, quadsToTurtle } from '../tripleGenerator'
import { schemaOrgOntology } from '../ontologies'
import type { MappingConfig, ParsedTable } from '../types'
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
  sparqlString,
  type Neighbourhood,
} from '../explore/neighbourhood'
import { displayLabel, labelCharsFor, layoutNeighbourhood, MAX_DRAWN_NEIGHBOURS } from '../explore/layout'
import {
  announceFocus,
  announceSelection,
  focusOf,
  initialNav,
  keyToAction,
  navigate,
  type NavState,
} from '../explore/navigation'

const BASE = 'https://example.org/people/'
const SCHEMA = 'https://schema.org/'

const mapping: MappingConfig = {
  baseIri: BASE,
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

function tableFromCsv(text: string): ParsedTable {
  const [head, ...lines] = text.trim().split(/\r?\n/)
  const headers = head.split(',')
  return {
    headers,
    rows: lines.map((l) => Object.fromEntries(headers.map((h, i) => [h, l.split(',')[i] ?? '']))),
    sampleValues: {},
  }
}

async function engineOver(table: ParsedTable): Promise<Engine> {
  const { quads } = generateTriples(table, mapping, schemaOrgOntology)
  const engine = createEngine(oxigraph)
  engine.load(await quadsToTurtle(quads, schemaOrgOntology))
  return engine
}

const labels = labelPredicates(mapping, schemaOrgOntology)
const prefixes = graphPrefixes(schemaOrgOntology)

describe('explorer queries over the sample CSV', () => {
  let engine: Engine
  const load = (iri: string) => parseNeighbourhood(iri, engine.run(neighbourhoodQuery(iri, labels)), labels)

  beforeAll(async () => {
    engine = await engineOver(tableFromCsv(readFileSync('public/examples/sample-people.csv', 'utf8')))
  })

  it("prefers the mapping's own name property for labels", () => {
    expect(labels[0]).toBe(`${SCHEMA}name`)
  })

  it('opens on the first entity of the mapped class', () => {
    expect(parseEntity(engine.run(firstEntityQuery(`${SCHEMA}Person`)))).toBe(`${BASE}1`)
  })

  it('counts entities and fetches one by position, for "random entity"', () => {
    expect(parseCount(engine.run(entityCountQuery(`${SCHEMA}Person`)))).toBe(3)
    expect(parseEntity(engine.run(entityAtQuery(`${SCHEMA}Person`, 2)))).toBe(`${BASE}3`)
  })

  it('builds a neighbourhood: name, type, values, and links in both directions', () => {
    const ada = load(`${BASE}1`)
    expect(ada.label).toBe('Ada Lovelace')
    expect(ada.types).toEqual([`${SCHEMA}Person`])
    expect(ada.literals.map((l) => l.predicate).sort()).toEqual(
      [`${SCHEMA}email`, `${SCHEMA}jobTitle`, `${SCHEMA}name`].sort(),
    )
    // Ada has no manager; Grace and Alan name her as colleague: two incoming links.
    expect(ada.edges.map((e) => [e.direction, e.targetLabel])).toEqual([
      ['in', 'Alan Turing'],
      ['in', 'Grace Hopper'],
    ])
    expect(ada.truncated).toBe(false)
  })

  it('lists outgoing links before incoming ones, with target labels', () => {
    const grace = load(`${BASE}2`)
    expect(grace.edges).toEqual([
      {
        id: `out|${SCHEMA}colleague|${BASE}1`,
        predicate: `${SCHEMA}colleague`,
        direction: 'out',
        target: `${BASE}1`,
        targetLabel: 'Ada Lovelace',
      },
    ])
  })

  it('never turns rdf:type into an edge to a class node', () => {
    const ada = load(`${BASE}1`)
    expect(ada.edges.some((e) => e.target === `${SCHEMA}Person`)).toBe(false)
  })

  it('returns an empty neighbourhood for an IRI not in the graph', () => {
    const nobody = load(`${BASE}999`)
    expect(nobody).toEqual({ iri: `${BASE}999`, label: undefined, types: [], literals: [], edges: [], truncated: false })
  })

  it('searches by name and by IRI, case-insensitively', () => {
    expect(parseSearch(engine.run(searchQuery('LOVE', labels)))).toEqual([{ iri: `${BASE}1`, label: 'Ada Lovelace' }])
    expect(parseSearch(engine.run(searchQuery('people/3', labels))).map((h) => h.label)).toEqual(['Alan Turing'])
    expect(parseSearch(engine.run(searchQuery('zzz', labels)))).toEqual([])
  })

  it('keeps search text inside the string literal (no query injection)', () => {
    const hostile = '") } DELETE WHERE { ?s ?p ?o } #'
    expect(() => engine.run(searchQuery(hostile, labels))).not.toThrow()
    expect(parseSearch(engine.run(searchQuery(hostile, labels)))).toEqual([])
    expect(sparqlString('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"')
  })

  it('refuses to put a malformed IRI into a query', () => {
    expect(() => neighbourhoodQuery('https://example.org/a> } DELETE {', labels)).toThrow(/Not a valid IRI/)
  })
})

describe('explorer on a larger graph', () => {
  it('caps the rows fetched for a hub and reports truncation', async () => {
    // One manager with 2,500 reports: far past the row limit.
    const rows = [{ employee_id: '1', name: 'Boss', email: '', job_title: '', hire_date: '', manager_id: '' }]
    for (let i = 2; i <= 2501; i++) {
      rows.push({ employee_id: String(i), name: `P${i}`, email: '', job_title: '', hire_date: '', manager_id: '1' })
    }
    const engine = await engineOver({ headers: Object.keys(rows[0]), rows, sampleValues: {} })
    const boss = parseNeighbourhood(`${BASE}1`, engine.run(neighbourhoodQuery(`${BASE}1`, labels)), labels)
    expect(boss.truncated).toBe(true)
    expect(boss.edges.length).toBeLessThanOrEqual(2000)
    const layout = layoutNeighbourhood(boss)
    expect(layout.neighbours).toHaveLength(MAX_DRAWN_NEIGHBOURS)
    expect(layout.hiddenCount).toBe(boss.edges.length - MAX_DRAWN_NEIGHBOURS)
  })
})

const edge = (n: number, direction: 'out' | 'in' = 'out') => ({
  id: `${direction}|p|t${n}`,
  predicate: `${SCHEMA}colleague`,
  direction,
  target: `${BASE}t${n}`,
  targetLabel: `T${n}`,
})
const nb = (edges = [edge(1), edge(2), edge(3, 'in')]): Neighbourhood => ({
  iri: `${BASE}f`,
  label: 'Focus',
  types: [`${SCHEMA}Person`],
  literals: [{ predicate: `${SCHEMA}name`, value: 'Focus' }],
  edges,
  truncated: false,
})

describe('radial layout', () => {
  it('places neighbours on a circle, starting at the top, clockwise, deterministically', () => {
    const layout = layoutNeighbourhood(nb(), 600, 400)
    const [top, second] = layout.neighbours
    expect(top.x).toBeCloseTo(layout.cx)
    expect(top.y).toBeLessThan(layout.cy)
    expect(second.x).toBeGreaterThan(layout.cx) // clockwise: next one is to the right
    expect(layoutNeighbourhood(nb(), 600, 400)).toEqual(layout)
  })

  it('never puts a neighbour straight below the focus, where its label goes', () => {
    for (let n = 1; n <= MAX_DRAWN_NEIGHBOURS; n++) {
      const layout = layoutNeighbourhood(nb(Array.from({ length: n }, (_, i) => edge(i))), 600, 400)
      for (const node of layout.neighbours) {
        const belowFocus = Math.abs(node.x - layout.cx) < 1 && node.y > layout.cy
        expect(belowFocus, `${n} neighbours`).toBe(false)
      }
    }
  })

  it('keeps side labels inside the drawing on narrow screens', () => {
    const named = (n: number, name: string) => ({ ...edge(n), targetLabel: name })
    const layout = layoutNeighbourhood(nb([named(1, 'Grace Hopper'), named(2, 'Alan Mathison Turing')]), 340, 320)
    expect(layout.labelChars).toBe(labelCharsFor(340))
    for (const node of layout.neighbours) {
      const room = node.x > layout.cx ? layout.width - node.x : node.x
      const drawnChars = Math.min(node.label.length, layout.labelChars)
      expect(room, node.label).toBeGreaterThanOrEqual(drawnChars * 6.5)
    }
  })

  it('sizes the ring from the names actually drawn', () => {
    const short = layoutNeighbourhood(nb([edge(1), edge(2)]), 640, 440)
    const long = layoutNeighbourhood(
      nb([{ ...edge(1), targetLabel: 'A very long organisation name indeed' }, edge(2)]),
      640,
      440,
    )
    expect(short.radius).toBeGreaterThan(long.radius)
    expect(long.labelChars).toBe(labelCharsFor(640))
  })

  it('names a shared property once instead of on every line', () => {
    expect(layoutNeighbourhood(nb()).sharedPredicate).toBe(`${SCHEMA}colleague`)
    const mixed = nb([edge(1), { ...edge(2), id: 'x', predicate: `${SCHEMA}knows` }])
    expect(layoutNeighbourhood(mixed).sharedPredicate).toBeUndefined()
    // A single link counts too: its line is often too short for a label.
    expect(layoutNeighbourhood(nb([edge(1)])).sharedPredicate).toBe(`${SCHEMA}colleague`)
    expect(layoutNeighbourhood(nb([])).sharedPredicate).toBeUndefined()
  })

  it('draws one node per neighbour even when several links reach it', () => {
    const twoLinks = nb([edge(1), { ...edge(1), id: 'out|q|t1', predicate: `${SCHEMA}knows` }])
    const layout = layoutNeighbourhood(twoLinks)
    expect(layout.neighbours).toHaveLength(1)
    expect(layout.neighbours[0].edges).toHaveLength(2)
  })

  it('falls back to the IRI tail when an entity has no name', () => {
    expect(displayLabel('https://example.org/people/42')).toBe('42')
    expect(displayLabel('https://example.org/ns#Thing')).toBe('Thing')
    expect(displayLabel('https://example.org/people/ada%20l')).toBe('ada l')
  })
})

describe('keyboard navigation', () => {
  const edges = nb().edges
  const run = (state: NavState, ...keys: string[]) =>
    keys.reduce((s, k) => navigate(s, keyToAction(k)!, edges), state)
  const start = navigate(initialNav, { type: 'start', iri: `${BASE}f` }, [])

  it('arrow keys move the selection around the links and wrap', () => {
    expect(run(start, 'ArrowRight').selected).toBe(0)
    expect(run(start, 'ArrowRight', 'ArrowDown').selected).toBe(1)
    expect(run(start, 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight').selected).toBe(0)
    expect(run(start, 'ArrowLeft').selected).toBe(2)
    expect(run(start, 'ArrowUp', 'ArrowUp').selected).toBe(1)
    expect(run(start, 'End').selected).toBe(2)
    expect(run(start, 'End', 'Home').selected).toBe(0)
  })

  it('Enter follows the selected link; Backspace goes back; the trail is the breadcrumb', () => {
    const there = run(start, 'ArrowRight', 'Enter')
    expect(focusOf(there)).toBe(`${BASE}t1`)
    expect(there.trail).toEqual([`${BASE}f`, `${BASE}t1`])
    expect(there.selected).toBeNull()
    const back = navigate(there, keyToAction('Backspace')!, [])
    expect(back.trail).toEqual([`${BASE}f`])
  })

  it('Enter with nothing selected, and Backspace at the start, do nothing', () => {
    expect(run(start, 'Enter')).toEqual(start)
    expect(run(start, 'Backspace')).toEqual(start)
  })

  it('Escape clears the selection', () => {
    expect(run(start, 'ArrowRight', 'Escape').selected).toBeNull()
  })

  it('jumping (search, random) extends the trail; going to the current entity does not', () => {
    const jumped = navigate(start, { type: 'go', iri: `${BASE}x` }, edges)
    expect(jumped.trail).toEqual([`${BASE}f`, `${BASE}x`])
    expect(navigate(jumped, { type: 'go', iri: `${BASE}x` }, []).trail).toHaveLength(2)
  })

  it('a breadcrumb click goes back to that point', () => {
    const deep = { trail: ['a', 'b', 'c', 'd'], selected: 1 }
    expect(navigate(deep, { type: 'backTo', index: 1 }, edges)).toEqual({ trail: ['a', 'b'], selected: null })
    expect(navigate(deep, { type: 'backTo', index: 3 }, edges)).toBe(deep)
  })

  it('arrow keys do nothing while a neighbourhood has no links (or is loading)', () => {
    expect(navigate(start, { type: 'next' }, [])).toBe(start)
  })

  it('leaves other keys to the browser (Tab, letters)', () => {
    expect(keyToAction('Tab')).toBeNull()
    expect(keyToAction('a')).toBeNull()
  })
})

describe('screen reader announcements', () => {
  it('describes arriving at an entity', () => {
    expect(announceFocus(nb(), prefixes, true)).toBe(
      'Now at Focus (Person). 3 links, 1 value. Use the arrow keys to move between links. Backspace goes back.',
    )
    expect(announceFocus(nb([]), prefixes, false)).toBe('Now at Focus (Person). 0 links, 1 value.')
  })

  it('describes the selected link with its direction and position', () => {
    expect(announceSelection(nb(), 0, prefixes)).toBe(
      'Focus → colleague → T1. Outgoing link 1 of 3. Press Enter to go to T1.',
    )
    expect(announceSelection(nb(), 2, prefixes)).toBe(
      'T3 → colleague → Focus. Incoming link 3 of 3. Press Enter to go to T3.',
    )
  })
})
