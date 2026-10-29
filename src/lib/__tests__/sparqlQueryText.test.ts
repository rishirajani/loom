import { describe, expect, it } from 'vitest'
import { classifyQuery, maskQuery, undeclaredPrefixes } from '../sparql/queryText'

describe('classifyQuery', () => {
  it.each([
    ['SELECT ?s WHERE { ?s ?p ?o }', 'select'],
    ['select * { ?s ?p ?o }', 'select'],
    ['ASK { ?s ?p ?o }', 'ask'],
    ['CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }', 'construct'],
    ['DESCRIBE <https://example.org/1>', 'describe'],
    ['INSERT DATA { <a:b> <a:c> "x" }', 'update'],
    ['DELETE WHERE { ?s ?p ?o }', 'update'],
    ['WITH <https://g> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }', 'update'],
    ['CLEAR DEFAULT', 'update'],
    ['SELEC ?x WHERE {}', 'unknown'],
    ['', 'unknown'],
  ])('%s → %s', (query, kind) => {
    expect(classifyQuery(query)).toBe(kind)
  })

  it('looks past PREFIX/BASE declarations and comments', () => {
    const query = `# find everyone
PREFIX schema: <https://schema.org/>
BASE <https://example.org/>
prefix ex: <https://example.org/ns#>   # trailing comment
ASK { ?s schema:name ?n }`
    expect(classifyQuery(query)).toBe('ask')
  })

  it('is not fooled by keywords inside comments, strings or IRIs', () => {
    expect(classifyQuery('# DELETE everything\nSELECT * { ?s ?p "INSERT" }')).toBe('select')
    expect(classifyQuery('PREFIX del: <https://example.org/DELETE#> SELECT * {}')).toBe('select')
  })
})

describe('maskQuery', () => {
  it('blanks strings, IRIs and comments but keeps length and newlines', () => {
    const query = 'SELECT * { ?s <https://x.org/a#b> "a # b" } # note\nLIMIT 1'
    const masked = maskQuery(query)
    expect(masked).toHaveLength(query.length)
    expect(masked).not.toMatch(/https|note|a # b/)
    expect(masked.split('\n')).toHaveLength(2)
    expect(masked).toMatch(/LIMIT 1$/)
  })

  it('treats < as an operator when it is not an IRI', () => {
    const masked = maskQuery('FILTER(?x < 5 && ?y > 2)')
    expect(masked).toContain('?x < 5')
  })

  it('handles long strings containing quotes and newlines', () => {
    const masked = maskQuery('SELECT * { ?s ?p """say "hi"\nschema:x""" }')
    expect(masked).not.toContain('schema:x')
  })
})

describe('undeclaredPrefixes', () => {
  it('finds prefixes used but not declared', () => {
    const query = `PREFIX schema: <https://schema.org/>
SELECT ?d WHERE { ?s schema:name ?n ; dct:issued ?d FILTER(datatype(?d) = xsd:date) }`
    expect(undeclaredPrefixes(query)).toEqual(['dct', 'xsd'])
  })

  it('ignores declarations, variables, strings, IRIs and language tags', () => {
    const query = `PREFIX schema: <https://schema.org/>
SELECT ?s WHERE { ?s schema:url <https://example.org/x:y> ; schema:name "foo:bar"@en }`
    expect(undeclaredPrefixes(query)).toEqual([])
  })

  it('reports the empty prefix', () => {
    expect(undeclaredPrefixes('SELECT * { ?s :p ?o }')).toEqual([''])
  })
})
