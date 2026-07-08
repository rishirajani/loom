import type { Ontology, OntologyProperty, SuggestedMapping } from './types'

// Stage 1 of the mapping-suggestion roadmap: cheap, local, no-ML lexical
// matching between column names and ontology property labels/comments.
// This intentionally ships before the embedding-based matcher (transformers.js)
// described in the architecture doc — it's fast, has zero bundle-size cost,
// and gives a real baseline to compare the embedding matcher against later.

function normalize(text: string): string {
  return text
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // acronym→word boundary: "ORGName" → "ORG Name"
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase and trailing acronyms: "employeeID" → "employee ID"
    .replace(/[_\-.]+/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
}

function tokenize(text: string): Set<string> {
  return new Set(normalize(text).split(/\s+/).filter(Boolean))
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection++
  const union = a.size + b.size - intersection
  return intersection / union
}

// Simple value-pattern checks used to break ties / boost confidence
// when a column's sample values match a property's expected datatype.
function valueMatchesRange(values: string[], property: OntologyProperty): number {
  if (!property.range || values.length === 0) return 0
  const datePattern = /^\d{4}-\d{2}-\d{2}/
  const urlPattern = /^https?:\/\//i
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const numberPattern = /^-?\d+(\.\d+)?$/

  let matches = 0
  for (const v of values) {
    const trimmed = v.trim()
    switch (property.range) {
      case 'xsd:date':
      case 'xsd:dateTime':
        if (datePattern.test(trimmed)) matches++
        break
      case 'xsd:anyURI':
        if (urlPattern.test(trimmed)) matches++
        break
      case 'xsd:integer':
      case 'xsd:decimal':
        if (numberPattern.test(trimmed)) matches++
        break
      default:
        if (property.id.includes('email') && emailPattern.test(trimmed)) matches++
        break
    }
  }
  return matches / values.length
}

export function suggestMappings(
  headers: string[],
  sampleValues: Record<string, string[]>,
  ontology: Ontology,
  rdfType: string,
): SuggestedMapping[] {
  const candidateProperties = ontology.properties.filter(
    (p) => !p.domain || p.domain.includes(rdfType),
  )
  const suggestions: SuggestedMapping[] = []

  for (const header of headers) {
    const headerTokens = tokenize(header)
    let best:
      | {
          property: OntologyProperty
          score: number
          labelEvidence: number
          labelScore: number
          aliasScore: number
          reason: string
        }
      | null = null

    for (const property of candidateProperties) {
      const labelTokens = tokenize(property.label)
      const commentTokens = property.comment ? tokenize(property.comment) : new Set<string>()

      const labelScore = jaccardSimilarity(headerTokens, labelTokens)
      // Alias hits count as label-level evidence: an alias is a curated
      // statement that this column name means this property.
      let aliasScore = 0
      for (const alias of property.aliases ?? []) {
        aliasScore = Math.max(aliasScore, jaccardSimilarity(headerTokens, tokenize(alias)))
      }
      const labelEvidence = Math.max(labelScore, aliasScore)
      const commentScore = jaccardSimilarity(headerTokens, commentTokens) * 0.5
      const valueScore = valueMatchesRange(sampleValues[header] ?? [], property) * 0.3

      const score = labelEvidence + commentScore + valueScore
      if (!best || score > best.score) {
        const reasonParts: string[] = []
        if (labelScore > 0) reasonParts.push('name matches property label')
        if (aliasScore > 0) reasonParts.push('name matches a known synonym')
        if (commentScore > 0) reasonParts.push('name relates to property description')
        if (valueScore > 0) reasonParts.push('sample values fit expected type')
        best = {
          property,
          score,
          labelEvidence,
          labelScore,
          aliasScore,
          reason: reasonParts.join('; ') || 'weak lexical match',
        }
      }
    }

    if (best && best.score > 0.15) {
      const evidence =
        best.aliasScore > 0 && best.aliasScore >= best.labelScore
          ? ('known synonym' as const)
          : best.labelScore >= 1
            ? ('exact name match' as const)
            : best.labelScore > 0
              ? ('name similarity' as const)
              : ('value pattern' as const)
      suggestions.push({
        column: header,
        predicate: best.property.id,
        confidence: Math.min(best.score, 1),
        reason: best.reason,
        evidence,
        // Pre-selecting requires real label/alias-level evidence. A match
        // built from shared filler tokens ("date" ↔ "date") plus value shape
        // is a hint, not a decision — hire_date must never silently become
        // birthDate again.
        strength: best.labelEvidence >= 0.5 ? 'strong' : 'weak',
      })
    }
  }

  return suggestions
}
