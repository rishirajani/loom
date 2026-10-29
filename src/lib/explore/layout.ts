import type { Edge, Neighbourhood } from './neighbourhood'

// A radial layout for one neighbourhood: the focus entity in the middle, each
// distinct neighbour on a circle around it, in the same order as the
// connections list so the picture and the list read the same way. No physics,
// no randomness: the same neighbourhood always draws the same.

/** Neighbours drawn around the focus; the rest stay reachable from the list. */
export const MAX_DRAWN_NEIGHBOURS = 16

export interface LaidOutNeighbour {
  target: string
  label: string
  x: number
  y: number
  /** angle in radians, 0 = right, clockwise (SVG y points down) */
  angle: number
  /** edges between the focus and this neighbour, in list order */
  edges: Edge[]
}

export interface Layout {
  width: number
  height: number
  cx: number
  cy: number
  radius: number
  neighbours: LaidOutNeighbour[]
  /** distinct neighbours not drawn because of MAX_DRAWN_NEIGHBOURS */
  hiddenCount: number
  /**
   * Set when every drawn link uses the same property: it is then shown once
   * as a caption instead of repeated on every line, where the labels would
   * pile up around the focus.
   */
  sharedPredicate?: string
  /** characters of a neighbour's name to draw before truncating */
  labelChars: number
}

export function displayLabel(iri: string, label?: string): string {
  if (label) return label
  const tail = iri.replace(/[/#]+$/, '').split(/[/#]/).pop()
  return tail ? decodeURIComponentSafe(tail) : iri
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Characters shown in a neighbour's label before truncation, by drawing width. */
export function labelCharsFor(width: number): number {
  return width < 480 ? 14 : 24
}

export function layoutNeighbourhood(nb: Neighbourhood, width = 640, height = 440): Layout {
  const byTarget = new Map<string, Edge[]>()
  for (const e of nb.edges) {
    const list = byTarget.get(e.target) ?? []
    list.push(e)
    byTarget.set(e.target, list)
  }
  const targets = [...byTarget.keys()]
  const drawn = targets.slice(0, MAX_DRAWN_NEIGHBOURS)
  const cx = width / 2
  const cy = height / 2
  const labelOf = (target: string) => displayLabel(target, byTarget.get(target)![0].targetLabel)
  // Leave room outside the circle for the names actually drawn: side labels
  // run horizontally (about 6.5px per character at 12px).
  const labelChars = Math.min(
    labelCharsFor(width),
    Math.max(4, ...drawn.map((t) => labelOf(t).length)),
  )
  const sideRoom = labelChars * 6.5 + 24
  const radius = Math.max(50, Math.min(width / 2 - sideRoom, height / 2 - 50))

  const neighbours = drawn.map((target, i) => {
    // Start at the top and go clockwise; a single neighbour sits to the right.
    // With an even count, rotate by half a step so no neighbour sits straight
    // below the focus, where the focus entity's own label is drawn.
    const step = (2 * Math.PI) / drawn.length
    const offset = drawn.length % 2 === 0 ? step / 2 : 0
    const angle = drawn.length === 1 ? 0 : -Math.PI / 2 + offset + step * i
    const edges = byTarget.get(target)!
    return {
      target,
      label: labelOf(target),
      x: round(cx + radius * Math.cos(angle)),
      y: round(cy + radius * Math.sin(angle)),
      angle,
      edges,
    }
  })
  const predicates = new Set(neighbours.flatMap((n) => n.edges.map((e) => e.predicate)))
  return {
    width,
    height,
    cx,
    cy,
    radius,
    neighbours,
    hiddenCount: targets.length - drawn.length,
    sharedPredicate: predicates.size === 1 ? [...predicates][0] : undefined,
    labelChars,
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}
