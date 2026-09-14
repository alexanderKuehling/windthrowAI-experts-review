// Named band-math formulas: the shipped library plus whatever the reviewer
// saves themselves.
//
// A recipe is just an expression with a name and a suggested way to display
// it. Two kinds:
//
//   index — one number per pixel, dropped into an index panel together with
//     the colour ramp and value range that make it readable (an NDVI shown on
//     a floating percentile stretch is a much weaker statement than the same
//     NDVI pinned to −1…1 on a diverging ramp).
//
//   mask — a 0/1 rule, used as a threshold overlay on top of any panel.
//     This is what turns the page into a comparison instrument: draw your own
//     rule over the imagery and see where it agrees with the model's mask.
//
// Reviewers can save their own of either kind; they ride along with custom
// presets, both in localStorage and in the per-account store on the backend.

import type { Domain } from "./channels"
import { isColormapId } from "./colormaps"
import type { ColormapId } from "./colormaps"

export type RecipeKind = "index" | "mask"

export interface Recipe {
  id: string
  label: string
  expr: string
  kind: RecipeKind
  builtin?: boolean
  /** One line on what it measures and how to read it. */
  note?: string
  /** Display defaults applied when an index recipe is loaded into a panel. */
  colormap?: ColormapId
  domain?: Domain
}

const FULL_RANGE: Domain = { kind: "fixed", min: -1, max: 1 }

// Tasselled-cap coefficients are Baig et al. (2014) for Landsat 8 OLI, which
// were derived against *top-of-atmosphere* reflectance. These tiles carry
// surface reflectance, so treat the three TC recipes as visually indicative —
// good for seeing structure, not for thresholding against published values.
const TC_BRIGHTNESS =
  "0.3029*B + 0.2786*G + 0.4733*R + 0.5599*nIR + 0.5080*swIR1 + 0.1872*swIR2"
const TC_GREENNESS =
  "-0.2941*B - 0.2430*G - 0.5424*R + 0.7276*nIR + 0.0713*swIR1 - 0.1608*swIR2"
const TC_WETNESS =
  "0.1511*B + 0.1973*G + 0.3283*R + 0.3407*nIR - 0.7117*swIR1 - 0.4559*swIR2"

export const BUILTIN_RECIPES: Recipe[] = [
  {
    id: "ndvi",
    label: "NDVI",
    kind: "index",
    expr: "nd(nIR, R)",
    builtin: true,
    note: "Greenness. Reliable, but saturates in dense closed canopy — a thinned stand and an intact one can look alike.",
    colormap: "RdYlGn",
    domain: FULL_RANGE,
  },
  {
    id: "ndmi",
    label: "NDMI",
    kind: "index",
    expr: "nd(nIR, swIR1)",
    builtin: true,
    note: "Canopy moisture. Drops sharply once the canopy is opened — one of the strongest single-date windthrow signals.",
    colormap: "BrBG",
    domain: FULL_RANGE,
  },
  {
    id: "nbr",
    label: "NBR (raw)",
    kind: "index",
    expr: "nd(nIR, swIR2)",
    builtin: true,
    note: "Burn ratio, in its true −1…1 range. Low values = bare ground, debris, scorched or dead material.",
    colormap: "RdYlGn",
    domain: FULL_RANGE,
  },
  {
    id: "nbr2",
    label: "NBR2",
    kind: "index",
    expr: "nd(swIR1, swIR2)",
    builtin: true,
    note: "Sensitive to dry woody material — and windthrow leaves a lot of it lying around.",
    colormap: "BrBG",
    domain: FULL_RANGE,
  },
  {
    id: "ndwi",
    label: "NDWI",
    kind: "index",
    expr: "nd(G, nIR)",
    builtin: true,
    note: "Open water. Mostly used here to rule water out of a candidate patch.",
    colormap: "RdBu",
    domain: FULL_RANGE,
  },
  {
    id: "savi",
    label: "SAVI",
    kind: "index",
    expr: "1.5 * (nIR - R) / (nIR + R + 0.5)",
    builtin: true,
    note: "Soil-adjusted greenness. Better than NDVI exactly where the canopy has opened and bare soil shows through.",
    colormap: "RdYlGn",
    domain: FULL_RANGE,
  },
  {
    id: "msavi",
    label: "MSAVI2",
    kind: "index",
    expr: "(2*nIR + 1 - sqrt((2*nIR + 1)^2 - 8*(nIR - R))) / 2",
    builtin: true,
    note: "SAVI without the hand-picked soil factor. Slower to compute, steadier over mixed ground.",
    colormap: "RdYlGn",
    domain: FULL_RANGE,
  },
  {
    id: "tc-brightness",
    label: "TC brightness",
    kind: "index",
    expr: TC_BRIGHTNESS,
    builtin: true,
    note: "Tasselled-cap brightness — overall reflectance. Bare ground and debris are bright. TOA coefficients on SR data: indicative only.",
    colormap: "viridis",
    domain: { kind: "percentile", low: 2, high: 98 },
  },
  {
    id: "tc-greenness",
    label: "TC greenness",
    kind: "index",
    expr: TC_GREENNESS,
    builtin: true,
    note: "Tasselled-cap greenness — vegetation vigour, independent of brightness. TOA coefficients on SR data: indicative only.",
    colormap: "RdYlGn",
    domain: { kind: "symmetric", center: 0 },
  },
  {
    id: "tc-wetness",
    label: "TC wetness",
    kind: "index",
    expr: TC_WETNESS,
    builtin: true,
    note: "Tasselled-cap wetness — falls off hard when canopy is removed. TOA coefficients on SR data: indicative only.",
    colormap: "BrBG",
    domain: { kind: "symmetric", center: 0 },
  },
  {
    id: "rule-low-nbr",
    label: "Low NBR",
    kind: "mask",
    expr: "nd(nIR, swIR2) < 0.2",
    builtin: true,
    note: "Bare, scorched or debris-covered ground. Move the threshold until it hugs what you can see.",
  },
  {
    id: "rule-open-canopy",
    label: "Open canopy",
    kind: "mask",
    expr: "nd(nIR, R) < 0.5",
    builtin: true,
    note: "Where greenness has dropped out of the closed-canopy range.",
  },
  {
    id: "rule-bright-swir",
    label: "Bright SWIR",
    kind: "mask",
    expr: "swIR2 > 0.18",
    builtin: true,
    note: "Exposed soil and dry woody debris — the tell-tale of a fresh throw.",
  },
  {
    id: "rule-water",
    label: "Water",
    kind: "mask",
    expr: "nd(G, nIR) > 0",
    builtin: true,
    note: "Overlay this to check a dark patch isn't simply a river.",
  },
  {
    id: "rule-combo",
    label: "Open + dry",
    kind: "mask",
    expr: "nd(nIR, R) < 0.5 and nd(nIR, swIR1) < 0.1",
    builtin: true,
    note: "Two conditions at once: canopy gone *and* moisture gone. Far fewer false positives than either alone.",
  },
]

export function newRecipeId(): string {
  return "recipe-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 5)
}

export function allRecipes(custom: Recipe[]): Recipe[] {
  return BUILTIN_RECIPES.concat(custom)
}

export function recipesOfKind(custom: Recipe[], kind: RecipeKind): Recipe[] {
  return allRecipes(custom).filter(r => r.kind === kind)
}

// ── Validation / persistence ────────────────────────────────────────────────

const LS_KEY = "windthrowai.bandRecipes.v1"

function isValidDomain(v: unknown): v is Domain {
  if (!v || typeof v !== "object") return false
  const d = v as Record<string, unknown>
  if (d.kind === "percentile") return typeof d.low === "number" && typeof d.high === "number"
  if (d.kind === "fixed") return typeof d.min === "number" && typeof d.max === "number"
  if (d.kind === "symmetric") return typeof d.center === "number"
  return false
}

export function isValidRecipe(v: unknown): v is Recipe {
  if (!v || typeof v !== "object") return false
  const r = v as Record<string, unknown>
  if (typeof r.id !== "string" || r.id.length === 0) return false
  if (typeof r.label !== "string" || r.label.length === 0) return false
  if (typeof r.expr !== "string" || r.expr.length === 0) return false
  if (r.kind !== "index" && r.kind !== "mask") return false
  if (r.note !== undefined && typeof r.note !== "string") return false
  if (r.colormap !== undefined && !isColormapId(r.colormap)) return false
  if (r.domain !== undefined && !isValidDomain(r.domain)) return false
  return true
}

/** Drop anything a built-in already owns — ids are the identity here. */
function withoutBuiltins(list: Recipe[]): Recipe[] {
  const builtinIds = new Set(BUILTIN_RECIPES.map(r => r.id))
  return list.filter(r => !builtinIds.has(r.id)).map(r => ({ ...r, builtin: false }))
}

export function parseRecipes(v: unknown): Recipe[] {
  if (!Array.isArray(v)) return []
  return withoutBuiltins(v.filter(isValidRecipe))
}

export function loadCustomRecipes(): Recipe[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    return parseRecipes(JSON.parse(raw))
  } catch {
    return []
  }
}

export function saveCustomRecipes(r: Recipe[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(r))
  } catch {
    // degrade silently
  }
}
