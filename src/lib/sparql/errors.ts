import { undeclaredPrefixes } from './queryText'

export interface FriendlyError {
  /** one or two plain sentences, safe to show as-is */
  message: string
  /**
   * Secondary detail from the parser ("expected one of LIMIT, OFFSET, …").
   * Shown smaller: it is often helpful for typos but can mislead, because it
   * lists what would have been valid where the parser stopped.
   */
  hint?: string
  /** 1-based line from Oxigraph's "error at L:C" */
  line?: number
  /**
   * For an undeclared prefix that Loom knows (one of the graph's own
   * prefixes), the PREFIX lines that would fix it — offered as a one-click fix.
   */
  fixPrefixes?: string[]
}

const POSITION = /^error at (\d+):(\d+):\s*/
const MAX_EXPECTED = 8

/**
 * Turn an Oxigraph error string into something a person can act on.
 *
 * Two quirks of Oxigraph's parser errors shape this:
 * - The position is where the parser *gave up*, which is often after the
 *   actual mistake (a typo'd SELECT is reported at the end of the line, a
 *   broken FILTER on the following line). So we say "near line N" and never
 *   draw a caret that would point at the wrong character.
 * - A missing PREFIX surfaces as "expected one of Prefix not found, ['%'],
 *   ['-' | '0' ..= '9' | ...]" — hundreds of characters of Unicode ranges.
 *   We find the undeclared prefix ourselves and name it.
 */
export function friendlyError(
  raw: string,
  query: string,
  knownPrefixes: Record<string, string> = {},
): FriendlyError {
  const text = raw.replace(/^(?:Error:\s*)+/, '').trim()
  const pos = POSITION.exec(text)
  const line = pos ? Number(pos[1]) : undefined
  const detail = pos ? text.slice(pos[0].length) : text
  const near = line !== undefined ? ` near line ${line}` : ''

  if (detail.includes('Prefix not found')) {
    const missing = undeclaredPrefixes(query)
    if (missing.length > 0) {
      const names = missing.map((p) => `${p}:`).join(', ')
      const plural = missing.length > 1
      const lines = missing.map((p) => (p in knownPrefixes ? `PREFIX ${p}: <${knownPrefixes[p]}>` : null))
      const allKnown = lines.every((l): l is string => l !== null)
      return {
        message: `Unknown prefix${plural ? 'es' : ''} ${names} — declare ${plural ? 'them' : 'it'} at the top of the query.`,
        hint: allKnown
          ? lines.join('\n')
          : `For example: PREFIX ${missing.find((p) => !(p in knownPrefixes))}: <https://example.org/ns#>`,
        line,
        fixPrefixes: allKnown ? lines : undefined,
      }
    }
    return { message: `A prefixed name${near} uses a prefix that isn't declared.`, line }
  }

  const expected = /^expected (?:one of )?(.*)$/s.exec(detail)
  if (expected) {
    // Oxigraph lists keywords and character classes; keep the readable keywords.
    const tokens = expected[1]
      .split(/,\s*/)
      .map((t) => t.trim())
      .filter((t) => /^[A-Za-z][A-Za-z_]*$/.test(t))
    const more = tokens.length > MAX_EXPECTED ? ', …' : ''
    return {
      message: `The query couldn't be parsed${near}. Check the spelling of keywords and that brackets and quotes are closed.`,
      hint: tokens.length ? `The parser expected one of: ${tokens.slice(0, MAX_EXPECTED).join(', ')}${more}` : undefined,
      line,
    }
  }

  return { message: pos ? `${detail}${near ? ` (${near.trim()})` : ''}` : detail, line }
}
