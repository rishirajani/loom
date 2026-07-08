import Papa from 'papaparse'
import type { ParsedTable } from './types'

export interface ParseResult {
  table: ParsedTable
  /** row-level problems PapaParse found (field mismatches, malformed quotes, etc.) */
  parseWarnings: string[]
}

export function parseCsvFile(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields ?? []
        if (headers.length === 0) {
          reject(new Error('No header row found in the CSV.'))
          return
        }
        const parseWarnings = results.errors.map((e) =>
          e.row !== undefined
            ? `Row ${e.row + 1}: ${e.message}`
            : e.message,
        )
        const rows = results.data
        const sampleValues: Record<string, string[]> = {}
        for (const header of headers) {
          const values = new Set<string>()
          for (const row of rows) {
            if (values.size >= 5) break
            const v = row[header]
            if (v) values.add(v)
          }
          sampleValues[header] = Array.from(values)
        }
        resolve({ table: { headers, rows, sampleValues }, parseWarnings })
      },
      error: (err) => reject(err),
    })
  })
}
