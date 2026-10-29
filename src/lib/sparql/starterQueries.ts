import { graphPrefixes } from '../tripleGenerator'
import type { MappingConfig, Ontology } from '../types'

export interface StarterQuery {
  id: string
  title: string
  /** one line on what the query shows, for the picker */
  description: string
  query: string
}

/** The PREFIX lines matching the prefixes in Loom's exported Turtle. */
export function prefixBlock(ontology: Ontology): string {
  return Object.entries(graphPrefixes(ontology))
    .map(([prefix, ns]) => `PREFIX ${prefix}: <${ns}>`)
    .join('\n')
}

function localName(id: string): string {
  return id.slice(id.indexOf(':') + 1)
}

function variableFor(id: string, taken: Set<string>): string {
  const base = localName(id).replace(/[^A-Za-z0-9_]/g, '_') || 'value'
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base}${n}`
  taken.add(name)
  return name
}

// Properties that read as an entity's display name, best first.
const LABEL_LOCAL_NAMES = ['name', 'title', 'label', 'prefLabel', 'givenName', 'familyName']

/**
 * The mapped property that best serves as an entity's display name (e.g.
 * schema:name, dct:title), or the first mapped literal property, or none.
 * Shared by the starter queries and the graph explorer so both label
 * entities the same way.
 */
export function labelPredicateFor(mapping: MappingConfig): string | undefined {
  const literalPredicates: string[] = []
  for (const col of mapping.columns) {
    if (col.kind === 'literal' && col.predicate && !literalPredicates.includes(col.predicate)) {
      literalPredicates.push(col.predicate)
    }
  }
  return (
    LABEL_LOCAL_NAMES.map((n) => literalPredicates.find((p) => localName(p) === n)).find(Boolean) ??
    literalPredicates[0]
  )
}

/**
 * Queries generated from the user's own mapping, so the first thing they see
 * in the editor runs against their data with their properties, rather than a
 * generic example they have to adapt. Every query here is pinned by a test
 * that runs it against a real generated graph.
 */
export function starterQueries(mapping: MappingConfig, ontology: Ontology): StarterQuery[] {
  const prologue = prefixBlock(ontology)
  const type = mapping.rdfType
  const classLabel = ontology.classes.find((c) => c.id === type)?.label ?? localName(type)

  const literalPredicates: string[] = []
  const refPredicates: string[] = []
  for (const col of mapping.columns) {
    if (col.kind === 'skip' || !col.predicate) continue
    const bucket = col.kind === 'objectRef' ? refPredicates : literalPredicates
    if (!bucket.includes(col.predicate)) bucket.push(col.predicate)
  }
  const labelPredicate = labelPredicateFor(mapping)

  const q = (body: string) => `${prologue}\n\n${body.trim()}\n`
  const queries: StarterQuery[] = []

  // 1. The mapped data as a table — one column per mapped property.
  {
    const taken = new Set(['entity'])
    const cols = literalPredicates.map((p) => ({ p, v: variableFor(p, taken) }))
    const labelVar = cols.find((c) => c.p === labelPredicate)?.v
    queries.push({
      id: 'table',
      title: `${classLabel} table`,
      description: `Every ${classLabel} with its mapped values, one row each.`,
      query: q(`
SELECT ?entity${cols.map((c) => ` ?${c.v}`).join('')}
WHERE {
  ?entity a ${type} .
${cols.map((c) => `  OPTIONAL { ?entity ${c.p} ?${c.v} }`).join('\n')}
}
ORDER BY ${labelVar ? `?${labelVar}` : '?entity'}
LIMIT 100`),
    })
  }

  // 2. Follow each object reference, showing labels on both ends when we have one.
  for (const ref of refPredicates.slice(0, 3)) {
    const name = localName(ref)
    queries.push({
      id: `follow-${name}`,
      title: `Follow ${ref}`,
      description: `Each ${classLabel} and the entity its ${name} links to.`,
      query: labelPredicate
        ? q(`
SELECT ?entity ?label ?target ?targetLabel
WHERE {
  ?entity ${ref} ?target .
  OPTIONAL { ?entity ${labelPredicate} ?label }
  OPTIONAL { ?target ${labelPredicate} ?targetLabel }
}
ORDER BY ?label
LIMIT 100`)
        : q(`
SELECT ?entity ?target
WHERE {
  ?entity ${ref} ?target .
}
LIMIT 100`),
    })
  }

  // 3. Coverage: how many entities actually have each property.
  queries.push({
    id: 'coverage',
    title: 'Property coverage',
    description: `How many ${classLabel} entities have a value for each property — gaps show up as low counts.`,
    query: q(`
SELECT ?property (COUNT(DISTINCT ?entity) AS ?entities)
WHERE {
  ?entity a ${type} ;
          ?property ?value .
}
GROUP BY ?property
ORDER BY DESC(?entities)`),
  })

  // 4. A yes/no data-quality check.
  if (labelPredicate) {
    queries.push({
      id: 'missing-label',
      title: `Any ${classLabel} without ${labelPredicate}?`,
      description: `A yes/no check (ASK): true means at least one ${classLabel} has no ${localName(labelPredicate)}.`,
      query: q(`
ASK {
  ?entity a ${type} .
  FILTER NOT EXISTS { ?entity ${labelPredicate} ?any }
}`),
    })
  }

  // 5. A graph-shaped result: everything stated about one entity.
  queries.push({
    id: 'one-entity',
    title: `One ${classLabel}, as triples`,
    description: 'A CONSTRUCT query: returns triples (Turtle) instead of a table.',
    query: q(`
CONSTRUCT { ?entity ?property ?value }
WHERE {
  { SELECT ?entity WHERE { ?entity a ${type} } ORDER BY ?entity LIMIT 1 }
  ?entity ?property ?value .
}`),
  })

  // 6. Counts by class — the most basic "what's in here".
  queries.push({
    id: 'classes',
    title: 'Entities by class',
    description: 'How many entities of each class the graph contains.',
    query: q(`
SELECT ?class (COUNT(?entity) AS ?count)
WHERE {
  ?entity a ?class .
}
GROUP BY ?class
ORDER BY DESC(?count)`),
  })

  return queries
}
