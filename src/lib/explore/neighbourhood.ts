import type { QueryResult, ResultTerm } from '../sparql/engine'
import { labelPredicateFor } from '../sparql/starterQueries'
import { resolvePrefixedIri } from '../tripleGenerator'
import type { MappingConfig, Ontology } from '../types'

// The explorer's view of the graph is one entity at a time: the focus node,
// what it says about itself (literal values), and the entities it links to
// or is linked from. Everything here is built from SPARQL over the same
// in-browser Oxigraph store the query tab uses.

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'
const SCHEMA_NAME = 'https://schema.org/name'
const DCT_TITLE = 'http://purl.org/dc/terms/title'

/** Hard cap on rows fetched for one neighbourhood, so a hub can't stall the page. */
export const NEIGHBOURHOOD_ROW_LIMIT = 2000

export interface Edge {
  /** stable within a neighbourhood: `${direction}|${predicate}|${target}` */
  id: string
  predicate: string
  /** 'out': focus → target. 'in': target → focus. */
  direction: 'out' | 'in'
  target: string
  targetLabel?: string
}

export interface LiteralValue {
  predicate: string
  value: string
  datatype?: string
  language?: string
}

export interface Neighbourhood {
  iri: string
  label?: string
  types: string[]
  literals: LiteralValue[]
  edges: Edge[]
  /** true when the row limit was hit and some links are not shown */
  truncated: boolean
}

export interface EntityHit {
  iri: string
  label?: string
}

/**
 * Full IRIs of the properties used to name entities, best first: the
 * mapping's own name-like property, then common vocabulary labels.
 */
export function labelPredicates(mapping: MappingConfig, ontology: Ontology): string[] {
  const mapped = labelPredicateFor(mapping)
  const first = mapped ? [resolvePrefixedIri(mapped, ontology)] : []
  return [...new Set([...first, RDFS_LABEL, SCHEMA_NAME, DCT_TITLE])]
}

function iri(value: string): string {
  // Values come from the graph or the mapping, never raw user text, but an
  // IRI containing '>' would still break out of <...>; refuse rather than guess.
  if (/[<>"{}|^`\\\s]/.test(value)) throw new Error(`Not a valid IRI for a query: ${value}`)
  return `<${value}>`
}

/** A SPARQL string literal with quotes, backslashes and newlines escaped. */
export function sparqlString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`
}

/** OPTIONAL label lookups for `?v`, folded into `?{v}Label` by COALESCE. */
function labelClauses(v: string, labels: string[]): string {
  const optionals = labels.map((p, i) => `  OPTIONAL { ?${v} ${iri(p)} ?${v}L${i} }`).join('\n')
  const coalesce = labels.map((_, i) => `?${v}L${i}`).join(', ')
  return `${optionals}\n  BIND(COALESCE(${coalesce}) AS ?${v}Label)`
}

/** The entity the explorer opens on: the first of the mapped class, by IRI. */
export function firstEntityQuery(typeIri: string): string {
  return `SELECT ?e WHERE { ?e a ${iri(typeIri)} } ORDER BY ?e LIMIT 1`
}

export function entityCountQuery(typeIri: string): string {
  return `SELECT (COUNT(DISTINCT ?e) AS ?n) WHERE { ?e a ${iri(typeIri)} }`
}

/** The entity at a given position in IRI order — used for "random entity". */
export function entityAtQuery(typeIri: string, offset: number): string {
  return `SELECT ?e WHERE { ?e a ${iri(typeIri)} } ORDER BY ?e OFFSET ${Math.max(0, Math.floor(offset))} LIMIT 1`
}

export function neighbourhoodQuery(focus: string, labels: string[]): string {
  const f = iri(focus)
  return `SELECT ?dir ?p ?o ?oLabel WHERE {
  { ${f} ?p ?o . BIND("out" AS ?dir) }
  UNION
  { ?o ?p ${f} . BIND("in" AS ?dir) }
${labelClauses('o', labels)}
}
LIMIT ${NEIGHBOURHOOD_ROW_LIMIT + 1}`
}

/** Entities whose name (or IRI) contains the text, case-insensitively. */
export function searchQuery(text: string, labels: string[], limit = 20): string {
  const needle = sparqlString(text.trim().toLowerCase())
  return `SELECT DISTINCT ?e ?eLabel WHERE {
  ?e a ?anyType .
${labelClauses('e', labels)}
  FILTER(CONTAINS(LCASE(STR(COALESCE(?eLabel, ""))), ${needle}) || CONTAINS(LCASE(STR(?e)), ${needle}))
}
ORDER BY LCASE(STR(COALESCE(?eLabel, STR(?e))))
LIMIT ${limit}`
}

function rowsOf(result: QueryResult): Record<string, ResultTerm>[] {
  if (result.kind !== 'select') throw new Error(`Expected a SELECT result, got ${result.kind}.`)
  return result.rows
}

export function parseEntity(result: QueryResult): string | undefined {
  const term = rowsOf(result)[0]?.e
  return term?.type === 'uri' ? term.value : undefined
}

export function parseCount(result: QueryResult): number {
  return Number(rowsOf(result)[0]?.n?.value ?? 0)
}

export function parseSearch(result: QueryResult): EntityHit[] {
  return rowsOf(result)
    .filter((r) => r.e?.type === 'uri')
    .map((r) => ({ iri: r.e.value, label: r.eLabel?.value }))
}

/**
 * Turn neighbourhood rows into the explorer's model:
 * - rdf:type values become the focus node's types, not edges (every entity
 *   would otherwise link to its class, which turns the class into a hub that
 *   says nothing about the entity itself).
 * - literal values become the details list.
 * - links to and from other entities become edges, one per (direction,
 *   predicate, target), ordered outgoing first, then by predicate and label.
 */
export function parseNeighbourhood(focus: string, result: QueryResult, labels: string[]): Neighbourhood {
  const rows = rowsOf(result)
  const truncated = rows.length > NEIGHBOURHOOD_ROW_LIMIT
  const types: string[] = []
  const literals: LiteralValue[] = []
  const literalKeys = new Set<string>()
  const edges = new Map<string, Edge>()

  for (const row of rows.slice(0, NEIGHBOURHOOD_ROW_LIMIT)) {
    const dir = row.dir?.value === 'in' ? 'in' : 'out'
    const p = row.p?.value
    const o = row.o
    if (!p || !o) continue

    if (dir === 'out' && p === RDF_TYPE && o.type === 'uri') {
      if (!types.includes(o.value)) types.push(o.value)
      continue
    }
    if (o.type === 'literal') {
      const key = `${p}|${o.value}|${o.datatype ?? ''}|${o['xml:lang'] ?? ''}`
      if (!literalKeys.has(key)) {
        literalKeys.add(key)
        literals.push({ predicate: p, value: o.value, datatype: o.datatype, language: o['xml:lang'] })
      }
      continue
    }
    // Loom never generates blank nodes; anything else can't be navigated to by IRI.
    if (o.type !== 'uri') continue
    if (o.value === focus && dir === 'in') continue // a self-loop is listed once, as outgoing
    const id = `${dir}|${p}|${o.value}`
    if (!edges.has(id)) {
      edges.set(id, {
        id,
        predicate: p,
        direction: dir,
        target: o.value,
        targetLabel: row.oLabel?.value,
      })
    }
  }

  // The focus node's own name: its value for the first label property it has.
  const label = labels.map((lp) => literals.find((l) => l.predicate === lp)?.value).find((v) => v !== undefined)

  const sorted = [...edges.values()].sort(
    (a, b) =>
      (a.direction === b.direction ? 0 : a.direction === 'out' ? -1 : 1) ||
      a.predicate.localeCompare(b.predicate) ||
      (a.targetLabel ?? a.target).localeCompare(b.targetLabel ?? b.target),
  )
  return { iri: focus, label, types, literals, edges: sorted, truncated }
}
