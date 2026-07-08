export type XsdType =
  | 'xsd:string'
  | 'xsd:integer'
  | 'xsd:decimal'
  | 'xsd:boolean'
  | 'xsd:date'
  | 'xsd:dateTime'
  | 'xsd:anyURI'

export interface OntologyProperty {
  /** e.g. "schema:givenName" */
  id: string
  label: string
  comment?: string
  /**
   * Common column-name synonyms that don't share tokens with the label,
   * e.g. worksFor: ['manager', 'employer']. Alias hits count as label-level
   * evidence in the suggester.
   */
  aliases?: string[]
  /** classes this property is typically used on, for filtering suggestions */
  domain?: string[]
  /** expected literal type, if this is a datatype property */
  range?: XsdType
  /** true if this property points to another entity rather than a literal */
  isObjectProperty?: boolean
}

export interface OntologyClass {
  id: string
  label: string
  comment?: string
}

export interface Ontology {
  id: string
  name: string
  prefix: string
  namespace: string
  classes: OntologyClass[]
  properties: OntologyProperty[]
}

export type MappingKind = 'literal' | 'objectRef' | 'skip'

export interface ColumnMapping {
  column: string
  kind: MappingKind
  /** ontology property id, required unless kind === 'skip' */
  predicate?: string
  datatype?: XsdType
  // NOTE: object references currently resolve against MappingConfig.identifierColumn
  // only. Per-reference target columns are roadmap work ("object-property mapping
  // refinements") — the field will be added when the generator actually honors it.
}

export interface MappingConfig {
  baseIri: string
  ontologyId: string
  rdfType: string
  identifierColumn: string | null
  columns: ColumnMapping[]
}

export interface ParsedTable {
  headers: string[]
  rows: Record<string, string>[]
  sampleValues: Record<string, string[]>
}

export interface SuggestedMapping {
  column: string
  predicate: string
  confidence: number
  reason: string
  /** short human-readable evidence category for the UI badge */
  evidence: 'exact name match' | 'known synonym' | 'name similarity' | 'value pattern'
  /**
   * 'strong' = real label/alias-level evidence; safe to pre-select.
   * 'weak' = generic evidence only (shared filler tokens, value shape);
   * shown as a hint the user must explicitly apply, never pre-selected.
   */
  strength: 'strong' | 'weak'
}
