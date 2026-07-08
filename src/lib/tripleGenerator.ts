import { DataFactory, Writer, type Quad } from 'n3'
import type { MappingConfig, Ontology, ParsedTable, XsdType } from './types'

const { namedNode, literal, quad } = DataFactory

const XSD = 'http://www.w3.org/2001/XMLSchema#'
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const DCT_NS = 'http://purl.org/dc/terms/'

function xsdIri(type: XsdType | undefined): string {
  const local = (type ?? 'xsd:string').split(':')[1]
  return `${XSD}${local}`
}

export function slugify(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase().replace(/\s+/g, '-'))
}

/**
 * Resolve a prefixed name like "schema:name" to a full IRI.
 * Throws on unknown prefixes rather than emitting invalid IRIs —
 * a hard error here is a mapping bug that must be surfaced, not serialized.
 */
export function resolvePrefixedIri(id: string, ontology: Ontology): string {
  if (id.startsWith('http://') || id.startsWith('https://')) return id
  const colonIndex = id.indexOf(':')
  if (colonIndex === -1) throw new Error(`"${id}" is not a valid prefixed name or IRI.`)
  const prefix = id.slice(0, colonIndex)
  const local = id.slice(colonIndex + 1)
  if (prefix === ontology.prefix) return `${ontology.namespace}${local}`
  if (prefix === 'dct') return `${DCT_NS}${local}`
  if (prefix === 'rdf') return `${RDF_NS}${local}`
  throw new Error(`Unknown prefix "${prefix}" in "${id}". Add its namespace to the ontology definition.`)
}

export interface GenerationResult {
  quads: Quad[]
  rowCount: number
  tripleCount: number
  warnings: string[]
  /** identifier values that appear on more than one row — a data integrity problem */
  duplicateIdentifiers: string[]
}

export function generateTriples(
  table: ParsedTable,
  mapping: MappingConfig,
  ontology: Ontology,
): GenerationResult {
  const quads: Quad[] = []
  const warnings: string[] = []
  const typeIri = resolvePrefixedIri(mapping.rdfType, ontology)

  // First pass: build subject IRIs, detecting identifier collisions.
  // Two distinct rows sharing an identifier (or two identifiers that slugify
  // to the same IRI) would silently merge into one subject — that's data
  // corruption, so we detect and report it instead of hiding it.
  const subjectByIdentifier = new Map<string, string>()
  const rowsByIri = new Map<string, number>()
  const duplicateIdentifiers = new Set<string>()

  const subjectForRow = table.rows.map((row, rowIndex) => {
    const idValue = mapping.identifierColumn ? row[mapping.identifierColumn] : undefined
    // Deterministic row-based fallback (not UUIDs): the same CSV exported
    // twice must produce the same subject IRIs, or diffs/merges downstream
    // become impossible. Row order is the identity when no column is chosen.
    const subjectIri = idValue
      ? `${mapping.baseIri}${slugify(idValue)}`
      : `${mapping.baseIri}row-${rowIndex + 1}`
    if (idValue) {
      if (rowsByIri.has(subjectIri)) duplicateIdentifiers.add(idValue)
      subjectByIdentifier.set(idValue, subjectIri)
    }
    rowsByIri.set(subjectIri, (rowsByIri.get(subjectIri) ?? 0) + 1)
    return subjectIri
  })

  table.rows.forEach((row, i) => {
    const subject = namedNode(subjectForRow[i])
    quads.push(quad(subject, namedNode(`${RDF_NS}type`), namedNode(typeIri)))

    for (const col of mapping.columns) {
      if (col.kind === 'skip' || !col.predicate) continue
      const rawValue = row[col.column]
      if (!rawValue) continue

      const predicateIri = resolvePrefixedIri(col.predicate, ontology)

      if (col.kind === 'objectRef') {
        // Object references currently resolve against the mapping's global
        // identifier column only. Referencing rows by an arbitrary column
        // (e.g. matching a name or email instead of the ID) is roadmap work —
        // see "object-property mapping refinements" in the README.
        const targetIri = subjectByIdentifier.get(rawValue)
        if (targetIri) {
          quads.push(quad(subject, namedNode(predicateIri), namedNode(targetIri)))
        } else {
          warnings.push(
            `Row ${i + 1}: column "${col.column}" references "${rawValue}", which doesn't match any row's identifier — skipped.`,
          )
        }
      } else {
        quads.push(
          quad(subject, namedNode(predicateIri), literal(rawValue, namedNode(xsdIri(col.datatype)))),
        )
      }
    }
  })

  return {
    quads,
    rowCount: table.rows.length,
    tripleCount: quads.length,
    warnings,
    duplicateIdentifiers: Array.from(duplicateIdentifiers),
  }
}

export function quadsToTurtle(quadList: Quad[], ontology: Ontology): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({
      prefixes: {
        [ontology.prefix]: ontology.namespace,
        dct: DCT_NS,
        xsd: XSD,
        rdf: RDF_NS,
      },
    })
    writer.addQuads(quadList)
    writer.end((error, result) => {
      if (error) reject(error)
      else resolve(result)
    })
  })
}
