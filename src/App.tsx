import { lazy, Suspense, useState } from 'react'
import { FileImport } from './components/FileImport'
import { MappingEditor } from './components/MappingEditor'
import { ResultsView } from './components/ResultsView'
import { bundledOntologies } from './lib/ontologies'
import type { MappingConfig, ParsedTable } from './lib/types'

// Loaded on demand: the query and explore views (and the Turtle parser they
// use) are only fetched when someone opens them, keeping the first load small.
// The 1.5 MB query engine itself loads separately, inside its worker.
const GraphWorkspace = lazy(() =>
  import('./components/GraphWorkspace').then((m) => ({ default: m.GraphWorkspace })),
)
type WorkspaceTab = 'query' | 'explore'

type Step = 'import' | 'map' | 'results' | 'query'

function App() {
  const [step, setStep] = useState<Step>('import')
  const [table, setTable] = useState<ParsedTable | null>(null)
  const [fileName, setFileName] = useState('')
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [mapping, setMapping] = useState<MappingConfig | null>(null)
  // The exact Turtle shown and downloaded on the results step, so queries run
  // over the same graph the user exports.
  const [queryTurtle, setQueryTurtle] = useState('')
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('query')
  const ontology = mapping ? bundledOntologies.find((o) => o.id === mapping.ontologyId) : undefined

  function reset() {
    setStep('import')
    setTable(null)
    setMapping(null)
    setParseWarnings([])
    setFileName('')
    setQueryTurtle('')
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--loom-line)]">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-semibold tracking-tight">Loom</span>
            <span className="text-sm text-neutral-500">spreadsheet → knowledge graph, in your browser</span>
          </div>
          {fileName && <span className="text-xs text-neutral-400 font-mono">{fileName}</span>}
        </div>
      </header>

      <main className="px-6 py-12">
        {parseWarnings.length > 0 && step !== 'import' && (
          <div className="max-w-4xl mx-auto mb-6">
            <details className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
              <summary className="cursor-pointer font-medium">
                {parseWarnings.length} issue(s) found while reading the CSV — affected rows may be incomplete
              </summary>
              <ul className="mt-2 space-y-1">
                {parseWarnings.slice(0, 20).map((w, i) => <li key={i}>{w}</li>)}
                {parseWarnings.length > 20 && <li>…and {parseWarnings.length - 20} more</li>}
              </ul>
            </details>
          </div>
        )}

        {step === 'import' && (
          <FileImport
            onParsed={(t, name, warnings) => {
              setTable(t)
              setFileName(name)
              setParseWarnings(warnings)
              setStep('map')
            }}
          />
        )}

        {step === 'map' && table && (
          <MappingEditor
            table={table}
            initial={mapping ?? undefined}
            onMappingReady={(m) => {
              setMapping(m)
              setStep('results')
            }}
          />
        )}

        {step === 'results' && table && mapping && (
          <ResultsView
            table={table}
            mapping={mapping}
            onBack={() => setStep('map')}
            onStartOver={reset}
            onOpen={(turtle, tab) => {
              setQueryTurtle(turtle)
              setWorkspaceTab(tab)
              setStep('query')
            }}
          />
        )}

        {step === 'query' && mapping && ontology && queryTurtle && (
          <Suspense
            fallback={<p className="max-w-4xl mx-auto text-sm text-neutral-500">Opening…</p>}
          >
            <GraphWorkspace
              turtle={queryTurtle}
              mapping={mapping}
              ontology={ontology}
              initialTab={workspaceTab}
              onBack={() => setStep('results')}
              onStartOver={reset}
            />
          </Suspense>
        )}
      </main>
    </div>
  )
}

export default App
