import Papa from 'papaparse'
import type { ParsedTable } from './types'

export interface ParseResult {
  table: ParsedTable
  /** row-level and header-level problems worth surfacing to the user */
  parseWarnings: string[]
}

/** Normalize a header: strip a leading UTF-8 BOM (common in Excel exports) and trim. */
function cleanHeader(header: string): string {
  return header.replace(/^\uFEFF/, '').trim()
}

interface HeaderPlan {
  /** cleaned header names, in column order; '' marks an unusable column to drop */
  cleaned: string[]
  warnings: string[]
}

/**
 * Turn the raw first row into a usable, unique set of column names, warning
 * about anything the user should know. We parse with `header: false` and build
 * the header map ourselves rather than letting PapaParse's `header: true` do
 * it, because PapaParse silently renames duplicate headers (`name` → `name_1`)
 * and we want that rename to be explicit and reported, not invisible.
 */
function planHeaders(rawHeaders: string[]): HeaderPlan {
  const warnings: string[] = []
  const cleaned: string[] = []
  const seen = new Map<string, number>()
  let emptyCount = 0
  const renamed: string[] = []

  for (const raw of rawHeaders) {
    const base = cleanHeader(raw)
    if (base === '') {
      emptyCount++
      cleaned.push('') // dropped downstream
      continue
    }
    const priorCount = seen.get(base) ?? 0
    seen.set(base, priorCount + 1)
    if (priorCount === 0) {
      cleaned.push(base)
    } else {
      const unique = `${base}_${priorCount}`
      cleaned.push(unique)
      renamed.push(`${base} → ${unique}`)
    }
  }

  if (renamed.length > 0) {
    warnings.push(
      `Duplicate column name${renamed.length > 1 ? 's' : ''} renamed so nothing is lost: ${renamed.join(', ')}.`,
    )
  }
  if (emptyCount > 0) {
    warnings.push(
      `${emptyCount} column${emptyCount > 1 ? 's have' : ' has'} an empty name (blank header or a trailing comma) and will be skipped.`,
    )
  }
  return { cleaned, warnings }
}

export function parseCsvFile(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    // Parse as arrays (header: false) so we control header handling ourselves.
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        const allRows = results.data
        if (allRows.length === 0) {
          reject(new Error('No header row found in the CSV.'))
          return
        }

        const { cleaned, warnings: headerWarnings } = planHeaders(allRows[0])
        const usableCols = cleaned
          .map((name, index) => ({ name, index }))
          .filter((c) => c.name !== '')

        if (usableCols.length === 0) {
          reject(new Error('No usable header row found in the CSV.'))
          return
        }

        const dataRows = allRows.slice(1)
        if (dataRows.length === 0) {
          reject(new Error('That CSV has a header row but no data rows.'))
          return
        }

        // Build header-keyed row objects from the usable columns only.
        const headers = usableCols.map((c) => c.name)
        const rows: Record<string, string>[] = dataRows.map((cells) => {
          const row: Record<string, string> = {}
          for (const { name, index } of usableCols) {
            row[name] = cells[index] ?? ''
          }
          return row
        })

        // A file can have real columns and rows but be entirely blank —
        // every cell empty. That yields bare subjects with no properties,
        // which is never the intent.
        const hasAnyValue = rows.some((row) => headers.some((h) => row[h].trim() !== ''))
        if (!hasAnyValue) {
          reject(new Error('That CSV has columns but every data cell is empty.'))
          return
        }

        const rowWarnings = results.errors.map((e) =>
          e.row !== undefined ? `Row ${e.row + 1}: ${e.message}` : e.message,
        )
        const parseWarnings = [...headerWarnings, ...rowWarnings]

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
