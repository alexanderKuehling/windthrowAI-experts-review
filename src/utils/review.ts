import { fromBlob } from "geotiff"
import {
  COVERAGE_INDEX_URL,
  INPUTS_INDEX_URL,
  REVIEW_API_URL,
  REVIEW_SUMMARY_API_URL,
  inputTifUrl,
  maskTifUrl,
} from "../constants"

// tile_id → windthrow coverage in % (see COVERAGE_INDEX_URL).
export type CoverageIndex = Record<string, number>

// A positive tile awaiting expert review.
export interface ReviewPatch {
  tileId: string
  width: number
  height: number
  bands: Float32Array[]  // 7 bands: R G B nIR swIR1 swIR2 NBR (raw reflectance)
  mask: Uint8Array       // proposed mask, 0 | 1, length = width * height
}

// Band layout of the model-input GeoTIFF (see amazon-scan config.BAND_NAMES).
export const BAND_LABELS = ["R", "G", "B", "nIR", "swIR1", "swIR2", "NBR"] as const

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.blob()
}

// Read every band of a (possibly multi-band) GeoTIFF as Float32Array[]. Input
// tiles are published as uint16 DN + GDAL scale/offset (export_for_frontend.py);
// applying those recovers the physical reflectance. Files without scale/offset
// (older float32 exports, masks) are passed through unchanged.
async function readAllBands(blob: Blob): Promise<{ width: number; height: number; bands: Float32Array[] }> {
  const tiff = await fromBlob(blob)
  const image = await tiff.getImage()
  const rasters = await image.readRasters()
  const bandsRaw = rasters as ArrayLike<number>[]
  const bands: Float32Array[] = []
  for (let i = 0; i < bandsRaw.length; i++) {
    const b = bandsRaw[i]
    const band = b instanceof Float32Array ? b : new Float32Array(b as ArrayLike<number>)
    // Sequential on purpose: concurrent getGDALMetadata() calls race on the lazy
    // tag load inside geotiff.js and resolve to null for all but the first.
    const meta = (await image.getGDALMetadata(i)) as Record<string, string> | null
    const scale = Number(meta?.SCALE ?? 1)
    const offset = Number(meta?.OFFSET ?? 0)
    if (Number.isFinite(scale) && Number.isFinite(offset) && (scale !== 1 || offset !== 0)) {
      for (let j = 0; j < band.length; j++) band[j] = band[j] * scale + offset
    }
    bands.push(band)
  }
  return { width: image.getWidth(), height: image.getHeight(), bands }
}

// Per-tile metadata read from inputs_index.csv. Every field is optional: the
// published CSV currently carries only tile_id + bbox, and a future re-export
// will add the scan's metric columns. Absent columns must never break the app.
export interface TileMeta {
  coverage?: number   // % of the tile flagged as windthrow  (column `coverage`)
  lonMin?: number     // column `lon_min`
  latMin?: number     // column `lat_min`
  lonMax?: number     // column `lon_max`
  latMax?: number     // column `lat_max`
  dateFirst?: string  // "YYYY-MM-DD", column `date_first`
  dateLast?: string   // "YYYY-MM-DD", column `date_last`
  clfProb?: number    // classifier confidence for the tile, column `clf_prob`
  kind?: TileKind     // column `kind`; absent = "flagged"
}

// "flagged": the classifier said windthrow and the model proposes a mask.
// "control": a random spot-check tile the classifier *rejected* (amazon-scan
// exports a small fixed sample of them with an empty mask), mixed into review
// so the misses — and a classifier drifting into flagging plain forest — become
// measurable at all. Every other reviewed tile was pre-selected by the model.
export type TileKind = "flagged" | "control"

export type TileMetaIndex = Record<string, TileMeta>

export interface TileIndex {
  tiles: string[]         // flagged tiles only — the pool the coverage filter applies to
  controlTiles: string[]  // spot-check tiles; empty until an export writes the `kind` column
  meta: TileMetaIndex     // both kinds
  coverage: CoverageIndex // derived, flagged tiles only; empty when the CSV has no `coverage` column
  scanId?: string         // the export round's scan_id (column `scan_id`), same on every row
}

// undefined when the column is absent, the cell is missing/empty, or not finite.
function num(cols: string[], idx: number): number | undefined {
  if (idx === -1) return undefined
  const raw = cols[idx]
  if (raw === undefined || raw === "") return undefined
  const v = Number(raw)
  return Number.isFinite(v) ? v : undefined
}

// undefined when the column is absent or the cell is missing/empty.
function str(cols: string[], idx: number): string | undefined {
  if (idx === -1) return undefined
  const raw = cols[idx]
  return raw === undefined || raw === "" ? undefined : raw
}

// Fetch the positive tiles from inputs_index.csv. Every column is resolved by
// header name and is optional beyond `tile_id` — the published CSV today only
// carries tile_id + bbox, and a future re-export will add coverage/dates.
export async function fetchTileIndex(): Promise<TileIndex> {
  const res = await fetch(INPUTS_INDEX_URL)
  if (!res.ok) throw new Error(`Could not load tile index (${res.status}).`)
  const text = await res.text()
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return { tiles: [], controlTiles: [], meta: {}, coverage: {} }
  const header = lines[0].split(",")
  const idCol = header.indexOf("tile_id")
  if (idCol === -1) throw new Error("inputs_index.csv is missing a tile_id column.")
  const covCol = header.indexOf("coverage")
  const lonMinCol = header.indexOf("lon_min")
  const latMinCol = header.indexOf("lat_min")
  const lonMaxCol = header.indexOf("lon_max")
  const latMaxCol = header.indexOf("lat_max")
  const dateFirstCol = header.indexOf("date_first")
  const dateLastCol = header.indexOf("date_last")
  const clfProbCol = header.indexOf("clf_prob")
  // Added by amazon-scan's export (AUTOMATION_PLAN.md 4.2), last column, same
  // value on every row — take the first non-empty one rather than re-reading it per row.
  const scanIdCol = header.indexOf("scan_id")
  const kindCol = header.indexOf("kind")

  const tiles: string[] = []
  const controlTiles: string[] = []
  const meta: TileMetaIndex = {}
  const coverage: CoverageIndex = {}
  let scanId: string | undefined
  for (const line of lines.slice(1)) {
    const cols = line.split(",") // rows shorter than the header are fine: num/str return undefined
    const id = cols[idCol]
    if (!id) continue
    const m: TileMeta = {
      coverage: num(cols, covCol),
      lonMin: num(cols, lonMinCol),
      latMin: num(cols, latMinCol),
      lonMax: num(cols, lonMaxCol),
      latMax: num(cols, latMaxCol),
      dateFirst: str(cols, dateFirstCol),
      dateLast: str(cols, dateLastCol),
      clfProb: num(cols, clfProbCol),
      kind: str(cols, kindCol) === "control" ? "control" : "flagged",
    }
    meta[id] = m
    if (!scanId) scanId = str(cols, scanIdCol)
    if (m.kind === "control") {
      // Kept out of `tiles` and `coverage`: a control's coverage is 0 by
      // construction, so the coverage filter would hide every one of them.
      controlTiles.push(id)
      continue
    }
    tiles.push(id)
    if (m.coverage !== undefined) coverage[id] = m.coverage
  }
  return { tiles, controlTiles, meta, coverage, scanId }
}

// Load the precomputed coverage index. Returns {} (no filtering) if the asset
// is missing or malformed, so the review flow keeps working without it.
export async function fetchCoverageIndex(): Promise<CoverageIndex> {
  try {
    const res = await fetch(COVERAGE_INDEX_URL)
    if (!res.ok) return {}
    const data: unknown = await res.json()
    return data && typeof data === "object" ? (data as CoverageIndex) : {}
  } catch {
    return {}
  }
}

// tile_id -> how many reviews it has so far and who submitted them (see
// tileloading's GET /reviews/summary).
export interface TileReviewInfo {
  n: number
  reviewers: string[]
}
export type ReviewSummary = Record<string, TileReviewInfo>

// Load the per-tile review summary, for tiered tile picking (F8). Returns {}
// on any failure — every tile then looks unreviewed, which degrades exactly
// to the old uniform-random pick, so a summary outage never blocks review.
export async function fetchReviewSummary(): Promise<ReviewSummary> {
  try {
    const res = await fetch(REVIEW_SUMMARY_API_URL)
    if (!res.ok) return {}
    const data: unknown = await res.json()
    return data && typeof data === "object" ? (data as ReviewSummary) : {}
  } catch {
    return {}
  }
}

export function pickRandomTile(tiles: string[], exclude?: string): string {
  const pool = exclude && tiles.length > 1 ? tiles.filter(t => t !== exclude) : tiles
  return pool[Math.floor(Math.random() * pool.length)]
}

// Fraction of the tile covered by the (windthrow) mask, expressed as a
// percentage in [0, 100]. Used both to show the current coverage and to filter
// out tiles whose proposed windthrow covers too little of the image.
export function maskCoverage(mask: Uint8Array): number {
  if (mask.length === 0) return 0
  let on = 0
  for (let i = 0; i < mask.length; i++) on += mask[i]
  return (on / mask.length) * 100
}

// Decoded patches, keyed by tile_id. Small on purpose: it exists so the tile
// prefetched while the reviewer works on the current one is already in memory
// when they hit Submit/Skip. Patches are treated as immutable by callers.
const PATCH_CACHE_LIMIT = 8
const patchCache = new Map<string, Promise<ReviewPatch>>()

// Load a single tile's input imagery + proposed mask, from cache when warm.
export function loadPatch(tileId: string): Promise<ReviewPatch> {
  const hit = patchCache.get(tileId)
  if (hit) return hit

  const pending = fetchPatch(tileId).catch(e => {
    patchCache.delete(tileId) // don't cache failures — a retry should hit the network
    throw e
  })
  patchCache.set(tileId, pending)
  while (patchCache.size > PATCH_CACHE_LIMIT) {
    patchCache.delete(patchCache.keys().next().value!)
  }
  return pending
}

// Warm the cache for a tile the reviewer is likely to see next. Failures are
// ignored here; they surface when (and if) the tile is actually loaded.
export function prefetchPatch(tileId: string): void {
  void loadPatch(tileId).catch(() => {})
}

async function fetchPatch(tileId: string): Promise<ReviewPatch> {
  const [inputBlob, maskBlob] = await Promise.all([
    fetchBlob(inputTifUrl(tileId)),
    fetchBlob(maskTifUrl(tileId)),
  ])

  const input = await readAllBands(inputBlob)
  const maskRead = await readAllBands(maskBlob)
  const maskBand = maskRead.bands[0]

  const mask = new Uint8Array(maskBand.length)
  for (let i = 0; i < maskBand.length; i++) mask[i] = maskBand[i] > 0 ? 1 : 0

  return {
    tileId,
    width: input.width,
    height: input.height,
    bands: input.bands,
    mask,
  }
}

// Encode a 0/1 mask as a single-channel-looking RGBA PNG (white = windthrow) for upload.
export async function encodeMaskPng(mask: Uint8Array, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!
  const img = ctx.createImageData(width, height)
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 255 : 0
    img.data[i * 4 + 0] = v
    img.data[i * 4 + 1] = v
    img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("mask PNG encode failed"))), "image/png"),
  )
}

// Thrown when the backend rejects the session token (e.g. expired). The UI
// uses this to send the reviewer back to the login screen.
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired — please sign in again.")
    this.name = "SessionExpiredError"
  }
}

// Count how many pixels differ between the originally proposed mask and the
// mask the reviewer submitted. This is the reviewer's "effort" signal that the
// ranking aggregates (a plain confirmation changes 0 pixels; a full rejection
// changes every previously-on pixel).
export function countChangedPixels(original: Uint8Array, edited: Uint8Array): number {
  const n = Math.min(original.length, edited.length)
  let changed = 0
  for (let i = 0; i < n; i++) if (original[i] !== edited[i]) changed++
  return changed
}

export type Verdict = "confirmed" | "edited" | "no_windthrow"

export interface ReviewSubmission {
  tileId: string
  verdict: Verdict
  mask: Uint8Array
  width: number
  height: number
  changedPixels?: number // pixels changed vs. the proposed mask (see countChangedPixels)
  reviewer?: string
  token?: string // session token from login; attributes the review server-side
  scanId?: string // the export round this tile was loaded from (see TileIndex.scanId)
  tileKind?: TileKind // spot-check or model-flagged tile, stored with the review
}

export async function submitReview(sub: ReviewSubmission): Promise<void> {
  const form = new FormData()
  form.append("tile_id", sub.tileId)
  form.append("verdict", sub.verdict)
  form.append("width", String(sub.width))
  form.append("height", String(sub.height))
  form.append("changed_pixels", String(sub.changedPixels ?? 0))
  if (sub.reviewer) form.append("reviewer", sub.reviewer)
  if (sub.scanId) form.append("scan_id", sub.scanId)
  if (sub.tileKind) form.append("tile_kind", sub.tileKind)
  // For a plain rejection we still send the (untouched) mask so the record is complete.
  const png = await encodeMaskPng(sub.mask, sub.width, sub.height)
  form.append("mask", new File([png], `${sub.tileId}_review.png`, { type: "image/png" }))

  const headers = sub.token ? { Authorization: `Bearer ${sub.token}` } : undefined
  const res = await fetch(REVIEW_API_URL, { method: "POST", headers, body: form })
  if (res.status === 401) throw new SessionExpiredError()
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`Submit failed (${res.status}). ${detail}`.trim())
  }
}
