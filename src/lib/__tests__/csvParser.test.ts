import { describe, expect, it } from 'vitest'
import { parseCsvFile } from '../csvParser'

// parseCsvFile takes a browser File and reads it via PapaParse's FileReader
// path, so these tests run in happy-dom (the `dom` project in vite.config.ts)
// rather than the node environment used by the pure-logic suites.
function csvFile(contents: string, name = 'test.csv'): File {
  return new File([contents], name, { type: 'text/csv' })
}

describe('parseCsvFile', () => {
  it('parses a well-formed CSV into headers, rows, and sample values', async () => {
    const { table, parseWarnings } = await parseCsvFile(
      csvFile('id,name\n1,Ada\n2,Grace'),
    )
    expect(table.headers).toEqual(['id', 'name'])
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0]).toEqual({ id: '1', name: 'Ada' })
    expect(table.sampleValues.name).toContain('Ada')
    expect(parseWarnings).toEqual([])
  })

  it('strips a UTF-8 BOM from the first header (Excel export case)', async () => {
    const { table } = await parseCsvFile(csvFile('\uFEFFemployee_id,name\n1,Ada'))
    expect(table.headers).toEqual(['employee_id', 'name'])
    // The row must be keyed by the cleaned header, or every lookup returns ''.
    expect(table.rows[0].employee_id).toBe('1')
  })

  it('trims surrounding whitespace from headers', async () => {
    const { table } = await parseCsvFile(csvFile('  id  , name \n1,Ada'))
    expect(table.headers).toEqual(['id', 'name'])
  })

  it('renames duplicate headers and warns instead of dropping a column', async () => {
    const { table, parseWarnings } = await parseCsvFile(csvFile('id,name,name\n1,Ada,Lovelace'))
    expect(table.headers).toEqual(['id', 'name', 'name_1'])
    expect(table.rows[0]).toEqual({ id: '1', name: 'Ada', name_1: 'Lovelace' })
    expect(parseWarnings.some((w) => w.toLowerCase().includes('duplicate'))).toBe(true)
  })

  // Regression: a generated rename must never collide with a header the file
  // already has. Here the second `name` used to become `name_1`, clashing with
  // the real `name_1` column; both mapped to one row key and `b` was silently
  // lost. Real headers keep their names; the duplicate skips to the next free
  // suffix.
  it('never renames a duplicate onto an existing header', async () => {
    const { table, parseWarnings } = await parseCsvFile(csvFile('name,name,name_1\na,b,c'))
    expect(table.headers).toEqual(['name', 'name_2', 'name_1'])
    expect(new Set(table.headers).size).toBe(table.headers.length)
    expect(table.rows[0]).toEqual({ name: 'a', name_2: 'b', name_1: 'c' })
    expect(parseWarnings.some((w) => w.includes('name → name_2'))).toBe(true)
  })

  it('skips past an existing suffix that appears before the duplicate', async () => {
    const { table } = await parseCsvFile(csvFile('name_1,name,name,name\nw,x,y,z'))
    expect(table.headers).toEqual(['name_1', 'name', 'name_2', 'name_3'])
    expect(table.rows[0]).toEqual({ name_1: 'w', name: 'x', name_2: 'y', name_3: 'z' })
  })

  it('drops empty-named columns (blank header / trailing comma) and warns', async () => {
    const { table, parseWarnings } = await parseCsvFile(csvFile('id,,email\n1,x,a@b.org'))
    expect(table.headers).toEqual(['id', 'email'])
    expect(table.rows[0]).toEqual({ id: '1', email: 'a@b.org' })
    expect(parseWarnings.some((w) => w.toLowerCase().includes('empty name'))).toBe(true)
  })

  it('rejects a file with no header row', async () => {
    await expect(parseCsvFile(csvFile(''))).rejects.toThrow(/no header/i)
  })

  it('rejects a header-only file with no data rows', async () => {
    await expect(parseCsvFile(csvFile('id,name'))).rejects.toThrow(/no data rows/i)
  })

  it('rejects a file where every data cell is empty', async () => {
    await expect(parseCsvFile(csvFile('id,name\n,\n,'))).rejects.toThrow(/every data cell is empty/i)
  })

  it('handles quoted headers containing commas', async () => {
    const { table } = await parseCsvFile(csvFile('id,"last,name"\n1,Lovelace'))
    expect(table.headers).toEqual(['id', 'last,name'])
    expect(table.rows[0]['last,name']).toBe('Lovelace')
  })

  it('ignores cells beyond the header count', async () => {
    // header: false returns ragged arrays; a row with more cells than the
    // header row declares should keep only the declared columns.
    const { table } = await parseCsvFile(csvFile('id,name\n1,Ada,extra'))
    expect(table.rows[0]).toEqual({ id: '1', name: 'Ada' })
  })

  it('fills missing trailing cells with empty strings', async () => {
    const { table } = await parseCsvFile(csvFile('id,name,email\n1,Ada'))
    expect(table.rows[0]).toEqual({ id: '1', name: 'Ada', email: '' })
  })

  it('surfaces PapaParse warnings for malformed rows instead of crashing', async () => {
    const { parseWarnings } = await parseCsvFile(
      csvFile('id,name\n1,"unclosed quote\n2,Grace'),
    )
    expect(parseWarnings.length).toBeGreaterThan(0)
  })
})
