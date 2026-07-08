import { describe, expect, it } from 'vitest'
import { generateTriples, quadsToTurtle, resolvePrefixedIri, slugify } from '../tripleGenerator'
import { schemaOrgOntology } from '../ontologies'
import type { MappingConfig, ParsedTable } from '../types'

const table: ParsedTable = {
  headers: ['id', 'name', 'email', 'manager_id'],
  rows: [
    { id: '1', name: 'Ada Lovelace', email: 'ada@example.org', manager_id: '' },
    { id: '2', name: 'Grace Hopper', email: 'grace@example.org', manager_id: '1' },
  ],
  sampleValues: {},
}

const mapping: MappingConfig = {
  baseIri: 'https://example.org/id/',
  ontologyId: 'schema-org',
  rdfType: 'schema:Person',
  identifierColumn: 'id',
  columns: [
    { column: 'name', kind: 'literal', predicate: 'schema:name', datatype: 'xsd:string' },
    { column: 'email', kind: 'literal', predicate: 'schema:email', datatype: 'xsd:string' },
    { column: 'manager_id', kind: 'objectRef', predicate: 'schema:worksFor' },
  ],
}

describe('generateTriples', () => {
  it('emits one rdf:type triple per row', () => {
    const result = generateTriples(table, mapping, schemaOrgOntology)
    const typeQuads = result.quads.filter((q) =>
      q.predicate.value.endsWith('#type'),
    )
    expect(typeQuads).toHaveLength(2)
  })

  it('resolves object references to the referenced row subject', () => {
    const result = generateTriples(table, mapping, schemaOrgOntology)
    const ref = result.quads.find((q) => q.predicate.value === 'https://schema.org/worksFor')
    expect(ref).toBeDefined()
    expect(ref!.object.value).toBe('https://example.org/id/1')
    expect(ref!.object.termType).toBe('NamedNode')
  })

  it('warns instead of emitting a triple for dangling references', () => {
    const dangling: ParsedTable = {
      ...table,
      rows: [{ id: '1', name: 'X', email: '', manager_id: '99' }],
    }
    const result = generateTriples(dangling, mapping, schemaOrgOntology)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('99')
    expect(result.quads.some((q) => q.predicate.value.endsWith('worksFor'))).toBe(false)
  })

  it('detects duplicate identifiers instead of silently merging rows', () => {
    const dupes: ParsedTable = {
      ...table,
      rows: [
        { id: '1', name: 'A', email: '', manager_id: '' },
        { id: '1', name: 'B', email: '', manager_id: '' },
      ],
    }
    const result = generateTriples(dupes, mapping, schemaOrgOntology)
    expect(result.duplicateIdentifiers).toEqual(['1'])
  })

  it('detects identifiers that collide after slugification', () => {
    const collide: ParsedTable = {
      headers: ['id', 'name'],
      rows: [
        { id: 'a b', name: 'X' },
        { id: 'a-b', name: 'Y' },
      ],
      sampleValues: {},
    }
    const result = generateTriples(collide, { ...mapping, columns: mapping.columns.slice(0, 1) }, schemaOrgOntology)
    expect(result.duplicateIdentifiers.length).toBeGreaterThan(0)
  })

  it('generates deterministic row IRIs when no identifier column is chosen', () => {
    const noId: MappingConfig = { ...mapping, identifierColumn: null }
    const first = generateTriples(table, noId, schemaOrgOntology)
    const second = generateTriples(table, noId, schemaOrgOntology)
    const subjects = (r: typeof first) => r.quads.map((q) => q.subject.value).sort()
    expect(subjects(first)).toEqual(subjects(second))
    expect(subjects(first)[0]).toBe('https://example.org/id/row-1')
  })

  it('skips empty cell values without emitting triples', () => {
    const result = generateTriples(table, mapping, schemaOrgOntology)
    // Ada's manager_id is empty — no worksFor triple for her, no warning either.
    const refs = result.quads.filter((q) => q.predicate.value.endsWith('worksFor'))
    expect(refs).toHaveLength(1)
  })
})

describe('resolvePrefixedIri', () => {
  it('resolves the ontology prefix', () => {
    expect(resolvePrefixedIri('schema:name', schemaOrgOntology)).toBe('https://schema.org/name')
  })

  it('passes through full IRIs', () => {
    expect(resolvePrefixedIri('https://example.org/x', schemaOrgOntology)).toBe('https://example.org/x')
  })

  it('throws on unknown prefixes instead of emitting invalid IRIs', () => {
    expect(() => resolvePrefixedIri('foaf:name', schemaOrgOntology)).toThrow(/unknown prefix/i)
  })

  it('rejects non-http URI schemes — intentional until ontologies declare their own prefixes', () => {
    // urn:/mailto:/doi: schemes are syntactically indistinguishable from
    // unknown prefixed names (foaf:name looks like a scheme too). Until the
    // Ontology type carries a declared prefix map, strict failure is safer
    // than silently minting garbage named nodes. See the multi-namespace
    // roadmap issue. Note this function is currently only called with
    // bundled-ontology predicates, so user data cannot hit this path yet.
    expect(() => resolvePrefixedIri('urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6', schemaOrgOntology)).toThrow()
    expect(() => resolvePrefixedIri('mailto:user@example.org', schemaOrgOntology)).toThrow()
  })

  it('throws on non-prefixed non-IRI strings', () => {
    expect(() => resolvePrefixedIri('justtext', schemaOrgOntology)).toThrow()
  })
})

describe('slugify', () => {
  it('collides "a b" with "a-b" — the case the pre-generation check must catch', () => {
    expect(slugify('a b')).toBe(slugify('a-b'))
  })

  it('is case-insensitive', () => {
    expect(slugify('John Smith')).toBe(slugify('john smith'))
  })

  it('percent-encodes characters unsafe in IRIs', () => {
    expect(slugify('a/b?c')).not.toContain('/')
    expect(slugify('a/b?c')).not.toContain('?')
  })

  it('encodes fragment and query characters so they cannot break Turtle serialization', () => {
    // A reviewer claimed raw #/? could inject into the IRI — pin the refutation.
    const slug = slugify('id#frag?query/path')
    expect(slug).not.toMatch(/[#?/]/)
    expect(slug).toContain('%23')
    expect(slug).toContain('%3F')
    expect(slug).toContain('%2F')
  })
})

describe('quadsToTurtle', () => {
  it('produces parseable turtle with prefixes', async () => {
    const result = generateTriples(table, mapping, schemaOrgOntology)
    const turtle = await quadsToTurtle(result.quads, schemaOrgOntology)
    expect(turtle).toContain('@prefix schema:')
    expect(turtle).toContain('schema:name')
  })
})
