import { Parser, Writer } from 'n3'
import type { ResultTerm } from './engine'

/** Shorten an IRI with the given prefixes; return it bracketed when none match. */
export function compactIri(iri: string, prefixes: Record<string, string>): string {
  let best: [string, string] | null = null
  for (const [prefix, ns] of Object.entries(prefixes)) {
    if (iri.startsWith(ns) && (!best || ns.length > best[1].length)) best = [prefix, ns]
  }
  if (best) {
    const local = iri.slice(best[1].length)
    // Only when the remainder is a plausible local name; otherwise keep it whole.
    if (/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(local) && !local.endsWith('.')) return `${best[0]}:${local}`
  }
  return `<${iri}>`
}

/** How a result cell reads in the table. Full detail stays in the title tooltip. */
export function termLabel(term: ResultTerm | undefined, prefixes: Record<string, string>): string {
  if (!term) return ''
  if (term.type === 'uri') return compactIri(term.value, prefixes)
  if (term.type === 'bnode') return `_:${term.value}`
  return term.value
}

/** Tooltip for a cell: the full IRI, or the literal's datatype / language. */
export function termTitle(term: ResultTerm | undefined, prefixes: Record<string, string>): string | undefined {
  if (!term) return undefined
  if (term.type === 'uri') return term.value
  if (term.type === 'literal') {
    if (term['xml:lang']) return `"${term.value}"@${term['xml:lang']}`
    if (term.datatype) return `"${term.value}"^^${compactIri(term.datatype, prefixes)}`
  }
  return undefined
}

/**
 * SPARQL 1.1 Query Results CSV: a header of variable names, then one line per
 * solution with each term's plain value (IRIs unbracketed, literals without
 * datatype), quoted where needed, CRLF line endings.
 */
export function resultsToCsv(vars: string[], rows: Record<string, ResultTerm>[]): string {
  const cell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = [vars.map(cell).join(',')]
  for (const row of rows) {
    lines.push(vars.map((v) => cell(row[v] ? (row[v].type === 'bnode' ? `_:${row[v].value}` : row[v].value) : '')).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

/** Re-serialize N-Triples as prefixed Turtle, matching Loom's export. */
export function ntriplesToTurtle(ntriples: string, prefixes: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const quads = new Parser({ format: 'N-Triples' }).parse(ntriples)
      const writer = new Writer({ prefixes })
      writer.addQuads(quads)
      writer.end((error, result) => (error ? reject(error) : resolve(result)))
    } catch (e) {
      reject(e)
    }
  })
}
