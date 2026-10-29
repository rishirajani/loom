import { describe, expect, it } from 'vitest'
import { suggestMappings } from '../mappingSuggester'
import { schemaOrgOntology, dcatOntology } from '../ontologies'

describe('suggestMappings', () => {
  it('matches exact label names', () => {
    const suggestions = suggestMappings(['email'], { email: ['ada@example.org'] }, schemaOrgOntology, 'schema:Person')
    expect(suggestions.find((s) => s.column === 'email')?.predicate).toBe('schema:email')
  })

  it('handles snake_case and camelCase column names', () => {
    const suggestions = suggestMappings(
      ['job_title', 'givenName'],
      { job_title: ['Engineer'], givenName: ['Ada'] },
      schemaOrgOntology,
      'schema:Person',
    )
    expect(suggestions.find((s) => s.column === 'job_title')?.predicate).toBe('schema:jobTitle')
    expect(suggestions.find((s) => s.column === 'givenName')?.predicate).toBe('schema:givenName')
  })

  it('handles trailing acronyms like HireDate and EmployeeURL', () => {
    const suggestions = suggestMappings(
      ['HireDate', 'HomepageURL'],
      { HireDate: ['2020-01-01'], HomepageURL: ['https://ada.example.org'] },
      schemaOrgOntology,
      'schema:Person',
    )
    const hire = suggestions.find((s) => s.column === 'HireDate')
    expect(hire).toBeDefined()
    const url = suggestions.find((s) => s.column === 'HomepageURL')
    expect(url?.predicate).toBe('schema:url')
  })

  it('marks hire_date → birthDate as weak: generic token+value evidence must not pre-select', () => {
    // The exact failure from Loom's first real export: hire_date was
    // pre-selected as birthDate at 76% and the user reasonably accepted it.
    const suggestions = suggestMappings(
      ['hire_date'],
      { hire_date: ['2019-03-01', '2020-06-15'] },
      schemaOrgOntology,
      'schema:Person',
    )
    const s = suggestions.find((x) => x.column === 'hire_date')
    expect(s?.predicate).toBe('schema:birthDate') // still the best lexical guess…
    expect(s?.strength).toBe('weak') // …but never silently applied
  })

  it('matches manager_id → colleague via alias, as strong', () => {
    // First fix attempt mapped manager_id → worksFor, which is semantically
    // wrong: worksFor's range is Organization, and manager references point
    // at people. schema:colleague is Person→Person. A review caught that the
    // alias fix had traded a silent miss for a confident semantic error.
    const suggestions = suggestMappings(
      ['manager_id'],
      { manager_id: ['1'] },
      schemaOrgOntology,
      'schema:Person',
    )
    const s = suggestions.find((x) => x.column === 'manager_id')
    expect(s?.predicate).toBe('schema:colleague')
    expect(s?.strength).toBe('strong')
  })

  it('organization-meaning aliases still map to worksFor', () => {
    const suggestions = suggestMappings(
      ['employer'],
      { employer: ['Acme Corp'] },
      schemaOrgOntology,
      'schema:Person',
    )
    expect(suggestions.find((x) => x.column === 'employer')?.predicate).toBe('schema:worksFor')
  })

  it('exact label matches are strong', () => {
    const suggestions = suggestMappings(['email'], { email: ['a@b.org'] }, schemaOrgOntology, 'schema:Person')
    expect(suggestions.find((s) => s.column === 'email')?.strength).toBe('strong')
  })

  it('respects the domain filter — event properties are not suggested for Person', () => {
    const suggestions = suggestMappings(
      ['start_date'],
      { start_date: ['2024-01-01'] },
      schemaOrgOntology,
      'schema:Person',
    )
    const s = suggestions.find((x) => x.column === 'start_date')
    // startDate's domain is schema:Event only; for a Person it must not be suggested.
    expect(s?.predicate).not.toBe('schema:startDate')
  })

  it('does not suggest anything for unmatchable columns', () => {
    const suggestions = suggestMappings(
      ['zzqx_internal_code'],
      { zzqx_internal_code: ['A1'] },
      schemaOrgOntology,
      'schema:Person',
    )
    expect(suggestions.find((s) => s.column === 'zzqx_internal_code')).toBeUndefined()
  })

  it('uses value patterns to boost date-typed properties', () => {
    const suggestions = suggestMappings(
      ['issued'],
      { issued: ['2023-05-01', '2024-01-15'] },
      dcatOntology,
      'dcat:Dataset',
    )
    expect(suggestions.find((s) => s.column === 'issued')?.predicate).toBe('dct:issued')
  })

  it('reports confidence between 0 and 1 with a human-readable reason', () => {
    const suggestions = suggestMappings(['name'], { name: ['Ada'] }, schemaOrgOntology, 'schema:Person')
    const s = suggestions.find((x) => x.column === 'name')
    expect(s).toBeDefined()
    expect(s!.confidence).toBeGreaterThan(0)
    expect(s!.confidence).toBeLessThanOrEqual(1)
    expect(s!.reason.length).toBeGreaterThan(0)
  })
})

describe('evidence labels', () => {
  it('labels exact matches, synonyms, and value-only matches distinctly', () => {
    const suggestions = suggestMappings(
      ['email', 'manager_id', 'hire_date'],
      { email: ['a@b.org'], manager_id: ['1'], hire_date: ['2020-01-01'] },
      schemaOrgOntology,
      'schema:Person',
    )
    expect(suggestions.find((s) => s.column === 'email')?.evidence).toBe('exact name match')
    expect(suggestions.find((s) => s.column === 'manager_id')?.evidence).toBe('known synonym')
    // hire_date's evidence is partial-token, not value-only: "date" overlaps
    expect(suggestions.find((s) => s.column === 'hire_date')?.evidence).toBe('name similarity')
  })
})

// Pinned decision: at most one column per property is pre-selected; other
// strong candidates become opt-in hints that say who won and why. Adapted from
// the stable one-to-one matching step in Open Ontologies (Rovai,
// arXiv:2605.09184) — see resolveCompetingSuggestions for how Loom differs.
describe('competing columns for one property', () => {
  const person = (headers: string[], values: Record<string, string[]> = {}) =>
    suggestMappings(headers, values, schemaOrgOntology, 'schema:Person')
  const get = (s: ReturnType<typeof person>, column: string) => s.find((x) => x.column === column)!
  const strongFor = (s: ReturnType<typeof person>, predicate: string) =>
    s.filter((x) => x.predicate === predicate && x.strength === 'strong').map((x) => x.column)

  it('pre-selects only one column per property', () => {
    // Before: all three were strong, so every person got three schema:name values.
    const s = person(['display_name', 'full_name', 'name'], {
      display_name: ['ada'],
      full_name: ['Ada Lovelace'],
      name: ['Ada'],
    })
    expect(strongFor(s, 'schema:name')).toEqual(['name'])
  })

  it('keeps the losers as hints that name the winner and the reason', () => {
    const s = person(['display_name', 'name'])
    const loser = get(s, 'display_name')
    expect(loser.predicate).toBe('schema:name')
    expect(loser.strength).toBe('weak')
    expect(loser.outranked).toEqual({ by: 'name', why: '“name” is an exact name match' })
    expect(get(s, 'name').outranked).toBeUndefined()
  })

  it('ranks an exact name match above a synonym, wherever it appears in the file', () => {
    const s = person(['mobile', 'telephone'])
    expect(strongFor(s, 'schema:telephone')).toEqual(['telephone'])
  })

  it('breaks a confidence tie on the unclamped score: phone also matches the description', () => {
    // phone, mobile and cell all reported confidence 1.00 (capped), but only
    // phone also matches "Phone number." — that real difference decides it.
    const s = person(['mobile', 'cell', 'phone'])
    expect(strongFor(s, 'schema:telephone')).toEqual(['phone'])
    expect(get(s, 'mobile').outranked?.why).toMatch(/^“phone” had more supporting evidence/)
  })

  it('falls back to column order for a true tie, and says so', () => {
    const s = person(['cell', 'mobile'])
    expect(strongFor(s, 'schema:telephone')).toEqual(['cell'])
    expect(get(s, 'mobile').outranked).toEqual({
      by: 'cell',
      why: '“cell” matched equally well and comes first in the file',
    })
  })

  it('is deterministic: same input, same winner', () => {
    const headers = ['cell', 'mobile', 'phone', 'name', 'full_name']
    expect(person(headers)).toEqual(person(headers))
  })

  it('leaves columns for different properties alone', () => {
    const s = person(['name', 'email', 'job_title'])
    expect(s.every((x) => x.strength === 'strong' && !x.outranked)).toBe(true)
  })

  it('does not touch weak suggestions — hire_date stays an ordinary hint', () => {
    const s = person(['birth_date', 'hire_date'], { birth_date: ['1990-01-01'], hire_date: ['2020-01-01'] })
    expect(strongFor(s, 'schema:birthDate')).toEqual(['birth_date'])
    expect(get(s, 'hire_date').strength).toBe('weak')
    expect(get(s, 'hire_date').outranked).toBeUndefined()
  })

  it('applies to object properties too: one colleague column pre-selected', () => {
    const s = person(['manager_id', 'supervisor_id'], { manager_id: ['1'], supervisor_id: ['2'] })
    expect(strongFor(s, 'schema:colleague')).toHaveLength(1)
  })

  it('works the same in DCAT: title beats dataset_title, keyword vs tags resolved', () => {
    const s = suggestMappings(
      ['dataset_title', 'title', 'tags', 'keyword'],
      {},
      dcatOntology,
      'dcat:Dataset',
    )
    expect(s.filter((x) => x.predicate === 'dct:title' && x.strength === 'strong').map((x) => x.column)).toEqual(['title'])
    expect(s.filter((x) => x.predicate === 'dcat:keyword' && x.strength === 'strong').map((x) => x.column)).toEqual(['keyword'])
  })
})
