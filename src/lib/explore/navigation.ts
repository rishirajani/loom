import { compactIri } from '../sparql/format'
import { displayLabel } from './layout'
import type { Edge, Neighbourhood } from './neighbourhood'

// Keyboard navigation for the explorer, as a pure state machine so every key
// is unit-tested. The model: you stand on one entity (the focus); arrow keys
// move a selection around its links; Enter follows the selected link; Backspace
// walks back along the trail you came by.

export interface NavState {
  /** entities visited, oldest first; the last one is the focus */
  trail: string[]
  /** index into the focus neighbourhood's edges, or null for no selection */
  selected: number | null
}

export type NavAction =
  | { type: 'start'; iri: string }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'select'; index: number }
  | { type: 'clear' }
  | { type: 'follow' }
  | { type: 'go'; iri: string }
  | { type: 'back' }
  | { type: 'backTo'; index: number }

export const initialNav: NavState = { trail: [], selected: null }

export function focusOf(state: NavState): string | undefined {
  return state.trail[state.trail.length - 1]
}

/**
 * Apply a navigation action. `edges` are the current focus's edges (needed to
 * move the selection and to follow a link); pass [] while it is loading.
 */
export function navigate(state: NavState, action: NavAction, edges: Edge[]): NavState {
  const n = edges.length
  switch (action.type) {
    case 'start':
      return { trail: [action.iri], selected: null }
    case 'next':
      if (n === 0) return state
      return { ...state, selected: state.selected === null ? 0 : (state.selected + 1) % n }
    case 'prev':
      if (n === 0) return state
      return { ...state, selected: state.selected === null ? n - 1 : (state.selected - 1 + n) % n }
    case 'first':
      return n === 0 ? state : { ...state, selected: 0 }
    case 'last':
      return n === 0 ? state : { ...state, selected: n - 1 }
    case 'select':
      return action.index >= 0 && action.index < n ? { ...state, selected: action.index } : state
    case 'clear':
      return { ...state, selected: null }
    case 'follow': {
      if (state.selected === null || !edges[state.selected]) return state
      return goTo(state, edges[state.selected].target)
    }
    case 'go':
      return goTo(state, action.iri)
    case 'back':
      if (state.trail.length < 2) return state
      return { trail: state.trail.slice(0, -1), selected: null }
    case 'backTo':
      if (action.index < 0 || action.index >= state.trail.length - 1) return state
      return { trail: state.trail.slice(0, action.index + 1), selected: null }
  }
}

function goTo(state: NavState, iri: string): NavState {
  if (focusOf(state) === iri) return { ...state, selected: null }
  return { trail: [...state.trail, iri], selected: null }
}

/** Map a key press on the explorer to an action, or null to let the browser handle it. */
export function keyToAction(key: string): NavAction | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return { type: 'next' }
    case 'ArrowLeft':
    case 'ArrowUp':
      return { type: 'prev' }
    case 'Home':
      return { type: 'first' }
    case 'End':
      return { type: 'last' }
    case 'Enter':
      return { type: 'follow' }
    case 'Backspace':
      return { type: 'back' }
    case 'Escape':
      return { type: 'clear' }
    default:
      return null
  }
}

/** "colleague" from https://schema.org/colleague, or the compact form. */
export function predicateLabel(predicate: string, prefixes: Record<string, string>): string {
  const compact = compactIri(predicate, prefixes)
  if (!compact.startsWith('<')) return compact.slice(compact.indexOf(':') + 1)
  return displayLabel(predicate)
}

/** One link, phrased for reading aloud and for the connections list. */
export function describeEdge(edge: Edge, focusName: string, prefixes: Record<string, string>): string {
  const pred = predicateLabel(edge.predicate, prefixes)
  const target = displayLabel(edge.target, edge.targetLabel)
  return edge.direction === 'out' ? `${focusName} → ${pred} → ${target}` : `${target} → ${pred} → ${focusName}`
}

/** What a screen reader hears when the selection moves. */
export function announceSelection(
  nb: Neighbourhood,
  index: number,
  prefixes: Record<string, string>,
): string {
  const edge = nb.edges[index]
  if (!edge) return ''
  const focusName = displayLabel(nb.iri, nb.label)
  const where = `${edge.direction === 'out' ? 'Outgoing' : 'Incoming'} link ${index + 1} of ${nb.edges.length}`
  return `${describeEdge(edge, focusName, prefixes)}. ${where}. Press Enter to go to ${displayLabel(edge.target, edge.targetLabel)}.`
}

/** What a screen reader hears on arriving at an entity. */
export function announceFocus(nb: Neighbourhood, prefixes: Record<string, string>, canGoBack: boolean): string {
  const name = displayLabel(nb.iri, nb.label)
  const type = nb.types.length ? ` (${nb.types.map((t) => predicateLabel(t, prefixes)).join(', ')})` : ''
  const links = nb.edges.length === 1 ? '1 link' : `${nb.edges.length} links`
  const values = nb.literals.length === 1 ? '1 value' : `${nb.literals.length} values`
  const hint = nb.edges.length ? ' Use the arrow keys to move between links.' : ''
  const back = canGoBack ? ' Backspace goes back.' : ''
  return `Now at ${name}${type}. ${links}, ${values}.${hint}${back}`
}
