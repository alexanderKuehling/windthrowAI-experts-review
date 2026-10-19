import { BandMathError, compileExpression, evaluateExpression } from "./bandmath"
import type { CompiledExpr } from "./bandmath"
import { colormapAt, colormapLut, isColormapId, isDiverging } from "./colormaps"
import type { ColormapId } from "./colormaps"
import { parseRecipes } from "./recipes"
import type { Recipe } from "./recipes"
import { PRESETS_API_URL } from "../constants"
import { SessionExpiredError } from "./auth"

/** "rgb" = three expressions → red/green/blue. "gray" = one expression →
 * colour ramp. The wire value stays "gray" for compatibility with presets
 * already saved in browsers and in the per-account store; it now means
 * "single value", and the ramp is whatever `colormap` says. */
export type ChannelMode = "rgb" | "gray"
export type StretchMode = "shared" | "per-channel"

/**
 * How pixel values map onto the 0…1 display range.
 *
 * `percentile` is per-tile and relative: it always fills the ramp, which makes
 * it the right choice for exploring an unfamiliar quantity, and the wrong one
 * for judging tiles against each other — the same grey means a different NBR
 * on the next tile. `fixed` pins the range so colour finally means the same
 * thing everywhere. `symmetric` keeps a diverging ramp's neutral colour
 * exactly on its pivot, which is the only way such a ramp tells the truth.
 */
export type Domain =
  | { kind: "percentile"; low: number; high: number }
  | { kind: "fixed"; min: number; max: number }
  | { kind: "symmetric"; center: number }

/** A 0/1 rule painted over the panel — your own threshold, drawn where you
 * can compare it against the imagery and the model's proposal. */
export interface ThresholdOverlay {
  expr: string
  /** "#rrggbb". */
  color: string
  /** 0…1. */
  alpha: number
}

/** One rendered composite: a single band-math formula (gray) or three (rgb). */
export interface ChannelPanel {
  id: string
  label: string
  mode: ChannelMode
  /** Expressions for the R, G, B display channels. In "gray" mode only [0] is used. */
  expressions: [string, string, string]
  stretch: StretchMode
  low?: number // percentile clip, default 2
  high?: number // percentile clip, default 98

  // ── All optional, all added after the original release. A panel saved
  // before they existed keeps rendering exactly as it did: greyscale, 2/98
  // percentile, no overlay.
  /** Colour ramp for "gray" panels. Default greyscale. */
  colormap?: ColormapId
  /** Flip the ramp end to end. */
  reverse?: boolean
  /** Value range mapped onto the ramp. Default: percentile(low, high). */
  domain?: Domain
  /** Ascending value breaks. N breaks render the index as N+1 flat classes. */
  bins?: number[]
  /** Display gamma for "rgb" panels; >1 lifts the shadows. Default 1. */
  gamma?: number
  /** Threshold rule drawn on top. */
  overlay?: ThresholdOverlay
}

/** A named, saved group of panels shown side by side. */
export interface ChannelPreset {
  id: string
  label: string
  builtin?: boolean
  panels: ChannelPanel[]
}

export function newPanelId(): string {
  return "panel-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6)
}

export function emptyPanel(): ChannelPanel {
  return {
    id: newPanelId(),
    label: "New layer",
    mode: "gray",
    expressions: ["R", "R", "R"],
    stretch: "per-channel",
    low: 2,
    high: 98,
    colormap: "grey",
  }
}

// How the built-in colour composites are drawn. True colour gets one fixed
// reflectance range for all three bands, so its hue stays true and means the
// same on every tile: 0…0.08 keeps closed canopy (R≈0.03, G≈0.05, B≈0.02) mid
// scale and lets bare soil and debris run bright. A per-tile percentile stretch
// put its low end just under the canopy values and blew their small differences
// up into neon green. The false-colour composites mix bands about ten times
// apart (nIR≈0.3 against R, G, swIR2≈0.03–0.05), so each channel gets its own
// stretch; a shared one left the weak channels at the bottom of the scale and
// the image a flat red (CIR) or green (SWIR), with the red mask lost on the red.
const TRUE_COLOUR_DISPLAY: Pick<ChannelPanel, "stretch" | "domain" | "gamma"> = {
  stretch: "shared",
  domain: { kind: "fixed", min: 0, max: 0.08 },
  gamma: 1.4,
}
const FALSE_COLOUR_DISPLAY: Pick<ChannelPanel, "stretch"> = { stretch: "per-channel" }

// Built-ins — ids are stable (persisted as the active preset, used as React
// keys). The two NBR views (standalone and inside "Compare all") show it in
// its true −1…1 range on a diverging ramp instead of a per-tile greyscale
// stretch: same quantity, but a colour that means the same thing on every
// tile, which is the point of the whole exercise. The multi-panel grid
// renders panels[0] for consumers (like the review page) that only care
// about one composite.
export const BUILTIN_PRESETS: ChannelPreset[] = [
  {
    id: "true",
    label: "True colour (R·G·B)",
    builtin: true,
    panels: [
      {
        id: "true-0",
        label: "True colour (R·G·B)",
        mode: "rgb",
        expressions: ["R", "G", "B"],
        ...TRUE_COLOUR_DISPLAY,
      },
    ],
  },
  {
    id: "veg",
    label: "Colour infrared (nIR·R·G)",
    builtin: true,
    panels: [
      {
        id: "veg-0",
        label: "Colour infrared (nIR·R·G)",
        mode: "rgb",
        expressions: ["nIR", "R", "G"],
        ...FALSE_COLOUR_DISPLAY,
      },
    ],
  },
  {
    id: "swir",
    label: "SWIR (swIR2·nIR·G)",
    builtin: true,
    panels: [
      {
        id: "swir-0",
        label: "SWIR (swIR2·nIR·G)",
        mode: "rgb",
        expressions: ["swIR2", "nIR", "G"],
        ...FALSE_COLOUR_DISPLAY,
      },
    ],
  },
  {
    id: "nbr",
    label: "NBR (−1…1)",
    builtin: true,
    panels: [
      {
        id: "nbr-0",
        label: "NBR, pinned to −1…1",
        mode: "gray",
        expressions: ["nd(nIR, swIR2)", "", ""],
        stretch: "shared",
        colormap: "RdYlGn",
        domain: { kind: "fixed", min: -1, max: 1 },
      },
    ],
  },
  {
    id: "moisture",
    label: "Canopy moisture (NDMI)",
    builtin: true,
    panels: [
      {
        id: "moisture-0",
        label: "NDMI, pinned to −1…1",
        mode: "gray",
        expressions: ["nd(nIR, swIR1)", "", ""],
        stretch: "shared",
        colormap: "BrBG",
        domain: { kind: "fixed", min: -1, max: 1 },
      },
    ],
  },
  {
    id: "compare",
    label: "Compare all",
    builtin: true,
    panels: [
      {
        id: "compare-0",
        label: "True colour",
        mode: "rgb",
        expressions: ["R", "G", "B"],
        ...TRUE_COLOUR_DISPLAY,
      },
      {
        id: "compare-1",
        label: "Colour infrared",
        mode: "rgb",
        expressions: ["nIR", "R", "G"],
        ...FALSE_COLOUR_DISPLAY,
      },
      {
        id: "compare-2",
        label: "SWIR",
        mode: "rgb",
        expressions: ["swIR2", "nIR", "G"],
        ...FALSE_COLOUR_DISPLAY,
      },
      {
        id: "compare-3",
        label: "NBR",
        mode: "gray",
        expressions: ["nd(nIR, swIR2)", "", ""],
        stretch: "shared",
        colormap: "RdYlGn",
        domain: { kind: "fixed", min: -1, max: 1 },
      },
    ],
  },
]

const DEFAULT_LOW = 2
const DEFAULT_HIGH = 98
export const DEFAULT_OVERLAY_COLOR = "#00e5ff"
export const DEFAULT_OVERLAY_ALPHA = 0.5

// Compiled expressions are re-used across re-renders (preset switch on the
// review page, keystrokes on the Channels page) — no need to recompile the
// same source string every frame. Bounded so a long editing session (one new
// source string per keystroke) can't grow it without limit.
const COMPILE_CACHE_MAX = 200
const compileCache = new Map<string, CompiledExpr>()
function compileCached(src: string): CompiledExpr {
  const hit = compileCache.get(src)
  if (hit) return hit
  const c = compileExpression(src)
  if (compileCache.size >= COMPILE_CACHE_MAX) {
    const oldest = compileCache.keys().next().value
    if (oldest !== undefined) compileCache.delete(oldest)
  }
  compileCache.set(src, c)
  return c
}

interface PatchLike {
  width: number
  height: number
  bands: Float32Array[]
}

/** What a render actually put on screen — the numbers a legend needs. */
export interface PanelStats {
  /** Resolved value range per rendered channel: 1 entry for an index, 3 for a composite. */
  ranges: [number, number][]
  /** Pixels that evaluated to no-data and were drawn transparent. */
  nodata: number
  /** Pixels lit by the threshold overlay, or null when the panel has none. */
  overlayPixels: number | null
}

/** The value range a panel maps onto its ramp, given the panel's settings. */
export function resolveDomain(panel: ChannelPanel): Domain {
  if (panel.domain) return panel.domain
  return { kind: "percentile", low: panel.low ?? DEFAULT_LOW, high: panel.high ?? DEFAULT_HIGH }
}

/** How many channels a panel actually renders. */
export function channelCount(panel: ChannelPanel): number {
  return panel.mode === "gray" ? 1 : 3
}

// Percentile bounds over the finite values only: no-data must not drag the
// stretch around, which is exactly what happened when it counted as zero.
function percentileRange(values: Float32Array[], low: number, high: number): [number, number] {
  let count = 0
  for (const v of values) {
    for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) count++
  }
  if (count === 0) return [0, 1] // nothing to measure — any range will do
  const flat = new Float64Array(count)
  let k = 0
  for (const v of values) {
    for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) flat[k++] = v[i]
  }
  flat.sort() // TypedArray sort is numeric
  const at = (p: number) => flat[Math.max(0, Math.min(count - 1, Math.floor(count * (p / 100))))]
  return [at(low), at(high)]
}

function computeRanges(panel: ChannelPanel, values: Float32Array[]): [number, number][] {
  const domain = resolveDomain(panel)
  if (domain.kind === "fixed") {
    return values.map(() => [domain.min, domain.max] as [number, number])
  }

  const low = domain.kind === "percentile" ? domain.low : panel.low ?? DEFAULT_LOW
  const high = domain.kind === "percentile" ? domain.high : panel.high ?? DEFAULT_HIGH

  let ranges: [number, number][]
  if (panel.stretch === "shared") {
    const shared = percentileRange(values, low, high)
    ranges = values.map(() => shared)
  } else {
    ranges = values.map(v => percentileRange([v], low, high))
  }

  if (domain.kind === "symmetric") {
    const c = domain.center
    ranges = ranges.map(([lo, hi]) => {
      const r = Math.max(Math.abs(lo - c), Math.abs(hi - c)) || 1
      return [c - r, c + r]
    })
  }
  return ranges
}

/** Class index a value falls into, given ascending breaks. */
export function binOf(value: number, bins: number[]): number {
  let k = 0
  while (k < bins.length && value >= bins[k]) k++
  return k
}

function parseColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const v = m ? parseInt(m[1], 16) : 0x00e5ff
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/**
 * Render one panel's expressions into RGBA pixels on `target`. Throws
 * BandMathError if any expression fails to compile — callers should catch
 * this and keep the previous frame rather than let the canvas go blank.
 *
 * No-data pixels are written fully transparent (alpha 0), so whatever sits
 * behind the canvas shows through rather than a lie about the value being 0.
 */
export function renderPanel(
  patch: PatchLike,
  panel: ChannelPanel,
  target: Uint8ClampedArray,
): PanelStats {
  const { width, height, bands } = patch
  const n = width * height

  const count = channelCount(panel)
  const compiled = panel.expressions.slice(0, count).map(compileCached)
  const values = compiled.map(c => evaluateExpression(c, bands, n))
  const ranges = computeRanges(panel, values)

  // Compiled up front so a broken overlay expression reports its error like
  // any other, instead of half-rendering the panel first.
  const overlay = panel.overlay?.expr.trim() ? panel.overlay : undefined
  const overlayValues = overlay ? evaluateExpression(compileCached(overlay.expr), bands, n) : null
  const [oR, oG, oB] = overlay ? parseColor(overlay.color) : [0, 0, 0]
  const oA = overlay ? Math.max(0, Math.min(1, overlay.alpha)) : 0

  const gamma = panel.mode === "rgb" && panel.gamma && panel.gamma > 0 ? panel.gamma : 1
  const invGamma = 1 / gamma

  // 0…1 position within the panel's range, gamma-corrected for composites.
  const norm = (v: number, lo: number, hi: number): number => {
    const t = Math.max(0, Math.min(1, (v - lo) / ((hi - lo) || 1)))
    return gamma === 1 ? t : Math.pow(t, invGamma)
  }

  let nodata = 0
  let overlayPixels = 0

  if (panel.mode === "gray") {
    const lut = colormapLut(panel.colormap, panel.reverse)
    const [lo, hi] = ranges[0]
    const src = values[0]
    // Class breaks collapse the ramp to one flat colour per class, so the
    // classes are precomputed rather than sampled per pixel.
    const bins = panel.bins && panel.bins.length > 0 ? [...panel.bins].sort((a, b) => a - b) : null
    const classColors = bins
      ? bins.concat([Infinity]).map((_, k) => {
          const t = (k + 0.5) / (bins.length + 1)
          const j = Math.round(t * 255) * 3
          return [lut[j], lut[j + 1], lut[j + 2]] as [number, number, number]
        })
      : null

    for (let i = 0; i < n; i++) {
      const o = i * 4
      const v = src[i]
      if (Number.isNaN(v)) {
        target[o] = target[o + 1] = target[o + 2] = target[o + 3] = 0
        nodata++
        continue
      }
      if (classColors) {
        const c = classColors[binOf(v, bins!)]
        target[o] = c[0]
        target[o + 1] = c[1]
        target[o + 2] = c[2]
      } else {
        const j = Math.round(norm(v, lo, hi) * 255) * 3
        target[o] = lut[j]
        target[o + 1] = lut[j + 1]
        target[o + 2] = lut[j + 2]
      }
      target[o + 3] = 255
    }
  } else {
    for (let i = 0; i < n; i++) {
      const o = i * 4
      const r = values[0][i]
      const g = values[1][i]
      const b = values[2][i]
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
        target[o] = target[o + 1] = target[o + 2] = target[o + 3] = 0
        nodata++
        continue
      }
      target[o] = Math.round(norm(r, ranges[0][0], ranges[0][1]) * 255)
      target[o + 1] = Math.round(norm(g, ranges[1][0], ranges[1][1]) * 255)
      target[o + 2] = Math.round(norm(b, ranges[2][0], ranges[2][1]) * 255)
      target[o + 3] = 255
    }
  }

  if (overlayValues) {
    for (let i = 0; i < n; i++) {
      const v = overlayValues[i]
      if (Number.isNaN(v) || v === 0) continue
      overlayPixels++
      const o = i * 4
      // Painted over no-data too, so a rule that fires there stays visible.
      if (target[o + 3] === 0) {
        target[o] = oR
        target[o + 1] = oG
        target[o + 2] = oB
        target[o + 3] = Math.round(oA * 255)
        continue
      }
      target[o] = target[o] * (1 - oA) + oR * oA
      target[o + 1] = target[o + 1] * (1 - oA) + oG * oA
      target[o + 2] = target[o + 2] * (1 - oA) + oB * oA
    }
  }

  return { ranges, nodata, overlayPixels: overlayValues ? overlayPixels : null }
}

/**
 * Render a preset's first panel into RGBA pixels on `target`. Kept for
 * consumers (the review page's paintable background) that only need one
 * composite rather than the full multi-panel grid.
 */
export function renderPreset(
  patch: PatchLike,
  preset: ChannelPreset,
  target: Uint8ClampedArray,
): PanelStats {
  const panel = preset.panels[0]
  if (!panel) throw new BandMathError("Preset has no layers.")
  return renderPanel(patch, panel, target)
}

/** Every value behind one pixel — the raw bands plus whatever this panel
 * computes from them. Throws BandMathError on a broken expression. */
export interface PixelProbe {
  bands: number[]
  channels: { label: string; expr: string; value: number }[]
  overlay: { expr: string; hit: boolean } | null
}

const RGB_LABELS = ["Red", "Green", "Blue"]

export function probePanel(patch: PatchLike, panel: ChannelPanel, i: number): PixelProbe {
  const bands = patch.bands.map(b => b[i])
  const count = channelCount(panel)
  const channels = panel.expressions.slice(0, count).map((expr, k) => ({
    label: panel.mode === "gray" ? "Value" : RGB_LABELS[k],
    expr,
    value: compileCached(expr).evalAt(patch.bands, i),
  }))
  let overlay: PixelProbe["overlay"] = null
  if (panel.overlay?.expr.trim()) {
    const v = compileCached(panel.overlay.expr).evalAt(patch.bands, i)
    overlay = { expr: panel.overlay.expr, hit: !Number.isNaN(v) && v !== 0 }
  }
  return { bands, channels, overlay }
}

/** Legend swatches for a binned index: class label + colour, low class first. */
export function binLegend(
  panel: ChannelPanel,
): { label: string; color: string }[] {
  const bins = panel.bins ? [...panel.bins].sort((a, b) => a - b) : []
  if (bins.length === 0) return []
  const fmt = (v: number) => formatValue(v)
  return bins.concat([Infinity]).map((_, k) => ({
    color: colormapAt(panel.colormap, (k + 0.5) / (bins.length + 1), panel.reverse),
    label:
      k === 0
        ? `< ${fmt(bins[0])}`
        : k === bins.length
          ? `≥ ${fmt(bins[bins.length - 1])}`
          : `${fmt(bins[k - 1])} – ${fmt(bins[k])}`,
  }))
}

/** Compact number for legends and probes: enough digits to tell values apart,
 * never so many that the label stops being readable. */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return "—"
  const a = Math.abs(v)
  if (a === 0) return "0"
  if (a >= 1000 || a < 0.001) return v.toExponential(1)
  if (a >= 100) return v.toFixed(0)
  if (a >= 10) return v.toFixed(1)
  if (a >= 1) return v.toFixed(2)
  return v.toFixed(3)
}

/** Display defaults for an index expression: a diverging ramp is only honest
 * when its neutral colour sits on the pivot, so choosing one implies a
 * symmetric (or fixed, if already symmetric) domain. */
export function domainForColormap(id: ColormapId | undefined, current: Domain): Domain {
  if (!isDiverging(id)) return current
  if (current.kind === "fixed" && current.min === -current.max) return current
  if (current.kind === "symmetric") return current
  return { kind: "symmetric", center: 0 }
}

/** Apply an index recipe's suggested display to a panel. */
export function applyRecipe(panel: ChannelPanel, recipe: Recipe, channel: number): ChannelPanel {
  if (recipe.kind === "mask") {
    return {
      ...panel,
      overlay: {
        expr: recipe.expr,
        color: panel.overlay?.color ?? DEFAULT_OVERLAY_COLOR,
        alpha: panel.overlay?.alpha ?? DEFAULT_OVERLAY_ALPHA,
      },
    }
  }
  const expressions: [string, string, string] = [...panel.expressions]
  expressions[channel] = recipe.expr
  // Ramp and range only make sense for the single-value panel, and only when
  // the recipe suggests them — an RGB channel keeps whatever the panel had.
  if (panel.mode === "rgb") return { ...panel, expressions }
  return {
    ...panel,
    expressions,
    colormap: recipe.colormap ?? panel.colormap,
    domain: recipe.domain ?? panel.domain,
    bins: undefined, // a fresh index starts continuous; classes are opt-in
  }
}

// ── Persistence ──────────────────────────────────────────────────────────

const LS_KEY = "windthrowai.channelPresets.v2"
const LEGACY_LS_KEY = "windthrowai.channelPresets.v1" // pre-multi-panel shape

function isValidDomain(v: unknown): v is Domain {
  if (!v || typeof v !== "object") return false
  const d = v as Record<string, unknown>
  if (d.kind === "percentile") return typeof d.low === "number" && typeof d.high === "number"
  if (d.kind === "fixed") return typeof d.min === "number" && typeof d.max === "number"
  if (d.kind === "symmetric") return typeof d.center === "number"
  return false
}

function isValidOverlay(v: unknown): v is ThresholdOverlay {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return (
    typeof o.expr === "string" &&
    typeof o.color === "string" &&
    typeof o.alpha === "number" &&
    o.alpha >= 0 &&
    o.alpha <= 1
  )
}

// Only the fields that existed from the start are required. Everything added
// since is optional and simply dropped when malformed (see sanitizePanel), so
// one bad colour ramp never costs a reviewer their whole preset.
function isValidPanel(v: unknown): v is ChannelPanel {
  if (!v || typeof v !== "object") return false
  const p = v as Record<string, unknown>
  if (typeof p.id !== "string" || p.id.length === 0) return false
  if (typeof p.label !== "string") return false
  if (p.mode !== "rgb" && p.mode !== "gray") return false
  if (p.stretch !== "shared" && p.stretch !== "per-channel") return false
  if (!Array.isArray(p.expressions) || p.expressions.length !== 3) return false
  if (!p.expressions.every(e => typeof e === "string")) return false
  return true
}

function sanitizePanel(p: ChannelPanel): ChannelPanel {
  const raw = p as unknown as Record<string, unknown>
  const bins = Array.isArray(raw.bins)
    ? (raw.bins as unknown[]).filter((b): b is number => typeof b === "number" && Number.isFinite(b))
    : undefined
  return {
    id: p.id,
    label: p.label,
    mode: p.mode,
    expressions: [p.expressions[0], p.expressions[1], p.expressions[2]],
    stretch: p.stretch,
    low: typeof raw.low === "number" ? raw.low : undefined,
    high: typeof raw.high === "number" ? raw.high : undefined,
    colormap: isColormapId(raw.colormap) ? raw.colormap : undefined,
    reverse: raw.reverse === true ? true : undefined,
    domain: isValidDomain(raw.domain) ? raw.domain : undefined,
    bins: bins && bins.length > 0 ? bins.sort((a, b) => a - b) : undefined,
    gamma: typeof raw.gamma === "number" && raw.gamma > 0 ? raw.gamma : undefined,
    overlay: isValidOverlay(raw.overlay) ? raw.overlay : undefined,
  }
}

function isValidPreset(v: unknown): v is ChannelPreset {
  if (!v || typeof v !== "object") return false
  const p = v as Record<string, unknown>
  if (typeof p.id !== "string" || p.id.length === 0) return false
  if (typeof p.label !== "string" || p.label.length === 0) return false
  if (!Array.isArray(p.panels) || p.panels.length === 0) return false
  if (!p.panels.every(isValidPanel)) return false
  return true
}

function sanitizePreset(p: ChannelPreset): ChannelPreset {
  return { id: p.id, label: p.label, panels: p.panels.map(sanitizePanel) }
}

function parsePresets(v: unknown): ChannelPreset[] {
  if (!Array.isArray(v)) return []
  return v.filter(isValidPreset).map(sanitizePreset)
}

// A saved preset from before multi-panel support: same fields as a panel,
// flattened onto the preset itself instead of nested under `panels`.
function isLegacyPreset(v: unknown): v is { id: string; label: string } & Omit<ChannelPanel, "id" | "label"> {
  if (!v || typeof v !== "object") return false
  const p = v as Record<string, unknown>
  if (typeof p.id !== "string" || p.id.length === 0) return false
  if (typeof p.label !== "string" || p.label.length === 0) return false
  if (p.mode !== "rgb" && p.mode !== "gray") return false
  if (p.stretch !== "shared" && p.stretch !== "per-channel") return false
  if (!Array.isArray(p.expressions) || p.expressions.length !== 3) return false
  if (!p.expressions.every(e => typeof e === "string")) return false
  return true
}

function migrateLegacyPresets(): ChannelPreset[] {
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isLegacyPreset).map(p => ({
      id: p.id,
      label: p.label,
      panels: [
        sanitizePanel({
          id: p.id + "-0",
          label: p.label,
          mode: p.mode,
          expressions: p.expressions,
          stretch: p.stretch,
          low: p.low,
          high: p.high,
        }),
      ],
    }))
  } catch {
    return []
  }
}

export function loadCustomPresets(): ChannelPreset[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return migrateLegacyPresets() // first run after upgrade — carry old presets forward
    return parsePresets(JSON.parse(raw))
  } catch {
    return []
  }
}

export function saveCustomPresets(p: ChannelPreset[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p))
  } catch {
    // degrade silently
  }
}

export function allPresets(custom: ChannelPreset[]): ChannelPreset[] {
  return BUILTIN_PRESETS.concat(custom)
}

export function newCustomId(): string {
  return "custom-" + Date.now().toString(36)
}

// ── Server-side persistence (signed-in reviewers) ───────────────────────────
//
// Custom presets and saved recipes follow the reviewer's account across
// devices/browsers via the tileloading backend (Firestore, one document per
// reviewer — see presets.py). localStorage stays as the store for anonymous
// guests (no token) and doubles as an offline cache: a load always seeds the
// in-memory state from localStorage first, then reconciles with the server
// when it's reachable, so the UI never blocks on the network.

/** Everything the Channels page owns, as one round trip. */
export interface PresetBundle {
  presets: ChannelPreset[]
  recipes: Recipe[]
}

export async function fetchPresetBundle(token: string): Promise<PresetBundle> {
  const res = await fetch(PRESETS_API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new SessionExpiredError()
  if (!res.ok) throw new Error(`Could not load presets (${res.status}).`)
  const data: unknown = await res.json()
  const body = data && typeof data === "object" ? (data as Record<string, unknown>) : {}
  return { presets: parsePresets(body.presets), recipes: parseRecipes(body.recipes) }
}

export async function pushPresetBundle(token: string, bundle: PresetBundle): Promise<void> {
  const res = await fetch(PRESETS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(bundle),
  })
  if (res.status === 401) throw new SessionExpiredError()
  if (!res.ok) throw new Error(`Could not save presets (${res.status}).`)
}
