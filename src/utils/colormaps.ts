// Colour ramps for single-value (index) panels.
//
// Two families, and the distinction matters more than the colours do:
//
//   sequential — for a quantity that only runs one way (brightness, a raw
//     reflectance band). Ramps here are perceptually uniform: equal steps in
//     value look like equal steps in colour, and they stay readable in
//     greyscale and for colour-blind viewers. That's why there's no rainbow /
//     jet ramp on offer — it invents edges where the data is smooth and
//     reverses apparent ordering, which is exactly what you don't want a
//     reviewer to trust.
//
//   diverging — for a quantity with a meaningful middle, which is every
//     nd()-style index: NDVI, NBR, NDMI all sit in −1…1 with 0 as a real
//     boundary. A diverging ramp is only honest when its neutral colour lands
//     exactly on that middle, so picking one of these nudges the panel's
//     domain to "symmetric around 0" (see channels.ts).

export type ColormapId =
  | "grey"
  | "viridis"
  | "magma"
  | "cividis"
  | "RdYlGn"
  | "RdBu"
  | "BrBG"

export type ColormapKind = "sequential" | "diverging"

export interface Colormap {
  id: ColormapId
  label: string
  kind: ColormapKind
  /** What the ramp is good for, shown next to the picker. */
  note: string
  /** Evenly spaced "#rrggbb" control points, low value → high value. */
  stops: string[]
}

export const COLORMAPS: Colormap[] = [
  {
    id: "grey",
    label: "Greyscale",
    kind: "sequential",
    note: "Neutral — no colour bias at all.",
    stops: ["#000000", "#ffffff"],
  },
  {
    id: "viridis",
    label: "Viridis (violet → yellow)",
    kind: "sequential",
    note: "Perceptually uniform, colour-blind safe. The safe default.",
    stops: [
      "#440154", "#482878", "#3e4a89", "#31688e", "#26828e",
      "#1f9e89", "#35b779", "#6dcd59", "#fde725",
    ],
  },
  {
    id: "magma",
    label: "Magma (black → cream)",
    kind: "sequential",
    note: "Wide dark range — good for picking detail out of shadow.",
    stops: [
      "#000004", "#180f3d", "#440f76", "#721f81", "#9e2f7f",
      "#cd4071", "#f1605d", "#fd9668", "#fcfdbf",
    ],
  },
  {
    id: "cividis",
    label: "Cividis (blue → yellow)",
    kind: "sequential",
    note: "Built for colour-vision deficiency; prints well.",
    stops: [
      "#00224e", "#123570", "#3b496c", "#575d6d", "#707173",
      "#8a8678", "#a99c7c", "#cbba69", "#fdea45",
    ],
  },
  {
    id: "RdYlGn",
    label: "Red → green (vegetation)",
    kind: "diverging",
    note: "Red = bare/dead, green = healthy. Matches interpreter intuition.",
    stops: [
      "#a50026", "#d73027", "#f46d43", "#fdae61", "#fee08b", "#ffffbf",
      "#d9ef8b", "#a6d96a", "#66bd63", "#1a9850", "#006837",
    ],
  },
  {
    id: "RdBu",
    label: "Red → blue",
    kind: "diverging",
    note: "Neutral-hued alternative when green would imply vegetation.",
    stops: [
      "#67001f", "#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#f7f7f7",
      "#d1e5f0", "#92c5de", "#4393c3", "#2166ac", "#053061",
    ],
  },
  {
    id: "BrBG",
    label: "Brown → teal (moisture)",
    kind: "diverging",
    note: "Brown = dry, teal = wet. The one for NDMI / NBR2.",
    stops: [
      "#543005", "#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#f5f5f5",
      "#c7eae5", "#80cdc1", "#35978f", "#01665e", "#003c30",
    ],
  },
]

const BY_ID = new Map(COLORMAPS.map(c => [c.id, c]))

export const DEFAULT_COLORMAP: ColormapId = "grey"

export function getColormap(id: ColormapId | undefined): Colormap {
  return BY_ID.get(id ?? DEFAULT_COLORMAP) ?? BY_ID.get(DEFAULT_COLORMAP)!
}

export function isColormapId(v: unknown): v is ColormapId {
  return typeof v === "string" && BY_ID.has(v as ColormapId)
}

export function isDiverging(id: ColormapId | undefined): boolean {
  return getColormap(id).kind === "diverging"
}

function parseHex(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** 256-entry RGB lookup table, built once per (colormap, direction). */
export type Lut = Uint8Array // length 256 * 3

const lutCache = new Map<string, Lut>()

export function colormapLut(id: ColormapId | undefined, reverse = false): Lut {
  const map = getColormap(id)
  const key = `${map.id}:${reverse ? "r" : "f"}`
  const hit = lutCache.get(key)
  if (hit) return hit

  const stops = (reverse ? [...map.stops].reverse() : map.stops).map(parseHex)
  const lut = new Uint8Array(256 * 3)
  const segments = stops.length - 1
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * segments
    const k = Math.min(segments - 1, Math.floor(t))
    const f = t - k
    const a = stops[k]
    const b = stops[k + 1]
    lut[i * 3 + 0] = Math.round(a[0] + (b[0] - a[0]) * f)
    lut[i * 3 + 1] = Math.round(a[1] + (b[1] - a[1]) * f)
    lut[i * 3 + 2] = Math.round(a[2] + (b[2] - a[2]) * f)
  }
  lutCache.set(key, lut)
  return lut
}

/** `linear-gradient(...)` for swatches and colour bars in the DOM. */
export function colormapGradient(id: ColormapId | undefined, reverse = false): string {
  const map = getColormap(id)
  const stops = reverse ? [...map.stops].reverse() : map.stops
  const parts = stops.map((c, i) => `${c} ${((i / (stops.length - 1)) * 100).toFixed(1)}%`)
  return `linear-gradient(to right, ${parts.join(", ")})`
}

/** Colour at a normalised position 0…1, as "#rrggbb" (for discrete legends). */
export function colormapAt(id: ColormapId | undefined, t: number, reverse = false): string {
  const lut = colormapLut(id, reverse)
  const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3
  const hex = (v: number) => v.toString(16).padStart(2, "0")
  return `#${hex(lut[i])}${hex(lut[i + 1])}${hex(lut[i + 2])}`
}
