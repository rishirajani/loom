// Lightweight lexical helpers for SPARQL text. These are not a parser: they
// exist so Loom can say something useful *before* or *after* Oxigraph does —
// classify a query so the right result format is requested, refuse updates
// with a clear message, and name an undeclared prefix that Oxigraph's own
// error only describes as a wall of character ranges.

export type QueryKind = 'select' | 'ask' | 'construct' | 'describe' | 'update' | 'unknown'

// IRIREF per the SPARQL grammar: '<', then no control characters, spaces or
// <>"{}|^`\ until '>'. Anything else starting with '<' is the less-than
// operator (e.g. FILTER(?x < 5)). Returns the end index, or -1 if not an IRI.
const NOT_IN_IRI = new Set('<"{}|^`\\')
function iriEnd(query: string, start: number): number {
  for (let j = start + 1; j < query.length; j++) {
    const c = query[j]
    if (c === '>') return j + 1
    if (c.charCodeAt(0) <= 0x20 || NOT_IN_IRI.has(c)) return -1
  }
  return -1
}

/**
 * Return a copy of the query, same length, with string literals, IRIs and
 * comments blanked out (newlines kept), so keyword and prefixed-name scans
 * can't be fooled by their contents.
 */
export function maskQuery(query: string): string {
  const out = query.split('')
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '
  }
  let i = 0
  while (i < query.length) {
    const ch = query[i]
    if (ch === '#') {
      const end = query.indexOf('\n', i)
      const stop = end === -1 ? query.length : end
      blank(i, stop)
      i = stop
    } else if (ch === '<') {
      const end = iriEnd(query, i)
      if (end !== -1) {
        blank(i, end)
        i = end
      } else {
        i++
      }
    } else if (ch === '"' || ch === "'") {
      const long = query.startsWith(ch.repeat(3), i)
      const delim = long ? ch.repeat(3) : ch
      let j = i + delim.length
      while (j < query.length && !query.startsWith(delim, j)) {
        if (query[j] === '\\') j++
        if (!long && query[j] === '\n') break // unterminated short string
        j++
      }
      const stop = Math.min(query.length, j + delim.length)
      blank(i, stop)
      i = stop
    } else {
      i++
    }
  }
  return out.join('')
}

const PROLOGUE = /^\s*(?:PREFIX\s+[A-Za-z0-9_.-]*:\s*|BASE\s*)/i
const UPDATE_KEYWORDS = /^(INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|COPY|MOVE|ADD|WITH)\b/i
const QUERY_KEYWORDS = /^(SELECT|ASK|CONSTRUCT|DESCRIBE)\b/i

export function classifyQuery(query: string): QueryKind {
  // IRIs are blanked by maskQuery, so `PREFIX ex: <...>` becomes
  // `PREFIX ex:` followed by spaces; strip those declarations, then read the
  // first keyword of the query body.
  let rest = maskQuery(query)
  for (;;) {
    const m = PROLOGUE.exec(rest)
    if (!m) break
    rest = rest.slice(m[0].length)
  }
  rest = rest.trimStart()
  const q = QUERY_KEYWORDS.exec(rest)
  if (q) return q[1].toLowerCase() as QueryKind
  if (UPDATE_KEYWORDS.test(rest)) return 'update'
  return 'unknown'
}

/** Prefixes declared with PREFIX in the query's prologue (or anywhere). */
export function declaredPrefixes(query: string): Set<string> {
  const masked = maskQuery(query)
  const found = new Set<string>()
  for (const m of masked.matchAll(/\bPREFIX\s+([A-Za-z0-9_.-]*):/gi)) found.add(m[1])
  return found
}

/**
 * Prefixes used in prefixed names (`schema:name`, `xsd:date`) that are not
 * declared. Variables (?x, $x) and the contents of strings/IRIs are ignored.
 */
export function undeclaredPrefixes(query: string): string[] {
  const masked = maskQuery(query)
  const declared = declaredPrefixes(query)
  const used: string[] = []
  // A prefixed name: optional PN_PREFIX, ':' and a local part. It must not be
  // preceded by a name character, ?, $ or ':' (so ?x:y-ish oddities and
  // `PREFIX foo:` declarations are skipped below).
  const re = /(^|[^A-Za-z0-9_.?$:-])([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*)?:(?=[A-Za-z0-9_%\\:-])/g
  for (const m of masked.matchAll(re)) {
    const prefix = m[2] ?? ''
    const before = masked.slice(0, (m.index ?? 0) + m[1].length)
    if (/PREFIX\s+$/i.test(before)) continue
    if (!declared.has(prefix) && !used.includes(prefix)) used.push(prefix)
  }
  return used
}
