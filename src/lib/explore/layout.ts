import type { Edge, Neighbourhood } from './neighbourhood'

// A radial layout for one neighbourhood: the focus entity in the middle, each
// distinct neighbour on a circle around it, in the same order as the
// connections list so the picture and the list read the same way. No physics,
// no randomness: the same neighbourhood always draws the same.
//
// The layout computes every position the drawing uses — circles, lines and
// all three kinds of text — so the renderer only draws, and the decision
// "do link names fit on the lines?" is made on exactly what will be drawn.

/** Neighbours drawn around the focus; the rest stay reachable from the list. */
export const MAX_DRAWN_NEIGHBOURS = 16

export const NAME_FONT = 12
export const EDGE_FONT = 10
export const FOCUS_FONT = 13
/** Max characters for a link's name on its line. */
export const EDGE_LABEL_CHARS = 22
const FOCUS_LABEL_CHARS = 30

export interface TextBox {
  text: string
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  fontSize: number
}

export interface LaidOutNeighbour {
  target: string
  label: string
  x: number
  y: number
  /** angle in radians, 0 = right, clockwise (SVG y points down) */
  angle: number
  /** edges between the focus and this neighbour, in list order */
  edges: Edge[]
  /** the line from the focus's edge to this neighbour's edge */
  line: { x1: number; y1: number; x2: number; y2: number }
  /** this neighbour's name, outside the ring */
  name: TextBox
  /** the link's property name(s), on the line */
  edgeLabel: TextBox
}

export interface Layout {
  width: number
  height: number
  cx: number
  cy: number
  radius: number
  focusR: number
  nodeR: number
  focus: { iri: string; name: TextBox }
  neighbours: LaidOutNeighbour[]
  /** distinct neighbours not drawn because of MAX_DRAWN_NEIGHBOURS */
  hiddenCount: number
  /**
   * Whether link names are drawn on every line. False only when some would
   * overlap each other, a circle or a name — then they collapse into one
   * caption (and the selected link still shows its name).
   */
  showEdgeLabels: boolean
  /** set when every drawn link uses the same property, for the caption */
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

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Characters shown in a neighbour's label before truncation, by drawing width. */
export function labelCharsFor(width: number): number {
  return width < 480 ? 14 : 24
}

/** Default name for a link: its property's local name. */
function defaultEdgeText(edges: Edge[]): string {
  return [...new Set(edges.map((e) => displayLabel(e.predicate)))].join(', ')
}

export function layoutNeighbourhood(
  nb: Neighbourhood,
  width = 640,
  height = 440,
  edgeText: (edges: Edge[]) => string = defaultEdgeText,
): Layout {
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
  // Smaller circles on a narrow drawing leave the lines long enough to read.
  const focusR = width < 480 ? 20 : 30
  const nodeR = width < 480 ? 7 : 9
  const labelOf = (target: string) => displayLabel(target, byTarget.get(target)![0].targetLabel)
  // Leave room outside the circle for the names actually drawn: side labels
  // run horizontally (about 6.5px per character at 12px).
  const labelChars = Math.min(labelCharsFor(width), Math.max(4, ...drawn.map((t) => labelOf(t).length)))
  const sideRoom = labelChars * 6.5 + 24
  const radius = Math.max(50, Math.min(width / 2 - sideRoom, height / 2 - 50))

  const neighbours: LaidOutNeighbour[] = drawn.map((target, i) => {
    // Start at the top and go clockwise; a single neighbour sits to the right.
    // With an even count, rotate by half a step so no neighbour sits straight
    // below the focus, where the focus entity's own label is drawn.
    const step = (2 * Math.PI) / drawn.length
    const offset = drawn.length % 2 === 0 ? step / 2 : 0
    const angle = drawn.length === 1 ? 0 : -Math.PI / 2 + offset + step * i
    const edges = byTarget.get(target)!
    const x = round(cx + radius * Math.cos(angle))
    const y = round(cy + radius * Math.sin(angle))
    const dx = x - cx
    const dy = y - cy
    const len = Math.hypot(dx, dy) || 1
    const cos = Math.cos(angle)
    const anchor = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle'
    return {
      target,
      label: labelOf(target),
      x,
      y,
      angle,
      edges,
      // Stop lines at the circles' edges so arrowheads stay visible.
      line: {
        x1: round(cx + (dx / len) * (focusR + 2)),
        y1: round(cy + (dy / len) * (focusR + 2)),
        x2: round(x - (dx / len) * (nodeR + 2)),
        y2: round(y - (dy / len) * (nodeR + 2)),
      },
      name: {
        text: truncate(labelOf(target), labelChars),
        x: x + (anchor === 'start' ? 14 : anchor === 'end' ? -14 : 0),
        y: y + (anchor === 'middle' ? (Math.sin(angle) > 0 ? 24 : -16) : 4),
        anchor,
        fontSize: NAME_FONT,
      },
      // Nearer the neighbour than the focus, where lines are further apart.
      edgeLabel: {
        text: truncate(edgeText(edges), EDGE_LABEL_CHARS),
        x: round(cx + dx * 0.62),
        y: round(cy + dy * 0.62 - 4),
        anchor: 'middle',
        fontSize: EDGE_FONT,
      },
    }
  })

  const focusName: TextBox = {
    text: truncate(displayLabel(nb.iri, nb.label), FOCUS_LABEL_CHARS),
    x: cx,
    y: cy + focusR + 18,
    anchor: 'middle',
    fontSize: FOCUS_FONT,
  }
  const predicates = new Set(neighbours.flatMap((n) => n.edges.map((e) => e.predicate)))
  const layout: Layout = {
    width,
    height,
    cx,
    cy,
    radius,
    focusR,
    nodeR,
    focus: { iri: nb.iri, name: focusName },
    neighbours,
    hiddenCount: targets.length - drawn.length,
    showEdgeLabels: true,
    sharedPredicate: predicates.size === 1 ? [...predicates][0] : undefined,
    labelChars,
  }
  layout.showEdgeLabels = edgeLabelsFit(layout)
  return layout
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

/** Approximate extent of drawn text: ~0.56em per character, baseline-relative height. */
export function textBox(t: TextBox): Box {
  const w = t.text.length * t.fontSize * 0.56
  const left = t.anchor === 'start' ? t.x : t.anchor === 'end' ? t.x - w : t.x - w / 2
  return { left, right: left + w, top: t.y - t.fontSize * 0.9, bottom: t.y + t.fontSize * 0.3 }
}

function circleBox(x: number, y: number, r: number): Box {
  return { left: x - r, right: x + r, top: y - r, bottom: y + r }
}

function overlaps(a: Box, b: Box, pad = 2): boolean {
  return a.left < b.right + pad && b.left < a.right + pad && a.top < b.bottom + pad && b.top < a.bottom + pad
}

/**
 * Link names go on the lines unless any of them would collide with another
 * link name, a circle, an entity's name, or the edge of the drawing. It's all
 * or nothing, so the drawing never mixes labelled and unlabelled lines.
 */
function edgeLabelsFit(layout: Layout): boolean {
  if (layout.neighbours.length === 0) return true
  const labels = layout.neighbours.map((n) => textBox(n.edgeLabel))
  const obstacles: Box[] = [
    circleBox(layout.cx, layout.cy, layout.focusR),
    textBox(layout.focus.name),
    ...layout.neighbours.flatMap((n) => [circleBox(n.x, n.y, layout.nodeR), textBox(n.name)]),
  ]
  for (let i = 0; i < labels.length; i++) {
    const box = labels[i]
    if (box.left < 0 || box.top < 0 || box.right > layout.width || box.bottom > layout.height) return false
    if (obstacles.some((o) => overlaps(box, o))) return false
    for (let j = i + 1; j < labels.length; j++) if (overlaps(box, labels[j])) return false
  }
  return true
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}
