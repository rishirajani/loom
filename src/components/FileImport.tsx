import { useCallback, useState } from 'react'
import { parseCsvFile } from '../lib/csvParser'
import type { ParsedTable } from '../lib/types'

interface Props {
  onParsed: (table: ParsedTable, fileName: string, parseWarnings: string[]) => void
}

export function FileImport({ onParsed }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(
    async (file: File) => {
      setError(null)
      if (!file.name.toLowerCase().endsWith('.csv')) {
        setError('Loom currently reads CSV files. Excel support (.xlsx) is next on the roadmap.')
        return
      }
      try {
        const { table, parseWarnings } = await parseCsvFile(file)
        onParsed(table, file.name, parseWarnings)
      } catch (e) {
        setError(
          e instanceof Error && e.message
            ? e.message
            : 'Could not read that file. Check that it’s a valid CSV and try again.',
        )
      }
    },
    [onParsed],
  )

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsDragging(false)
          const file = e.dataTransfer.files[0]
          if (file) handleFile(file)
        }}
        className={`rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
          isDragging ? 'border-[var(--loom-thread)] bg-[var(--loom-thread-light)]/10' : 'border-[var(--loom-line)]'
        }`}
      >
        <p className="text-lg font-medium mb-2">Drop a CSV file here</p>
        <p className="text-sm text-neutral-500 mb-6">Your file stays in this browser tab. Nothing is uploaded anywhere.</p>
        <label className="inline-block cursor-pointer rounded-full bg-[var(--loom-ink)] text-white px-6 py-2 text-sm font-medium hover:opacity-90 transition-opacity">
          Choose file
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />
        </label>
      </div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
  )
}
