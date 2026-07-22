import { fromBlob } from "geotiff"
import {
  COVERAGE_INDEX_URL,
  INPUTS_INDEX_URL,
  REVIEW_API_URL,
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

// Channel presets — each maps a display channel (red/green/blue) to a source band index.
export interface ChannelPreset {
  id: string
  label: string
  bands: [number, number, number] // source band indices for R, G, B display channels
}

export const CHANNEL_PRESETS: ChannelPreset[] = [
  { id: "true",  label: "True Color",       bands: [0, 1, 2] },
  { id: "veg",   label: "Vegetation (nIR)", bands: [3, 0, 1] },
  { id: "swir",  label: "SWIR",             bands: [5, 3, 1] },
  { id: "nbr",   label: "NBR (burn ratio)", bands: [6, 6, 6] },
]

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.blob()
}

// Read every band of a (possibly multi-band) GeoTIFF as Float32Array[].
async function readAllBands(blob: Blob): Promise<{ width: number; height: number; bands: Float32Array[] }> {
  const tiff = await fromBlob(blob)
  const image = await tiff.getImage()
  const rasters = await image.readRasters()
  const bandsRaw = rasters as ArrayLike<number>[]
  const bands = bandsRaw.map(b =>
    b instanceof Float32Array ? b : new Float32Array(b as ArrayLike<number>),
  )
  return { width: image.getWidth(), height: image.getHeight(), bands }
}

// Fetch the list of positive tile_ids from inputs_index.csv.
export async function fetchTileList(): Promise<string[]> {
  const res = await fetch(INPUTS_INDEX_URL)
  if (!res.ok) throw new Error(`Could not load tile index (${res.status}).`)
  const text = await res.text()
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const header = lines[0].split(",")
  const idCol = header.indexOf("tile_id")
  if (idCol === -1) throw new Error("inputs_index.csv is missing a tile_id column.")
  return lines.slice(1).map(l => l.split(",")[idCol]).filter(Boolean)
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

// Load a single tile's input imagery + proposed mask.
export async function loadPatch(tileId: string): Promise<ReviewPatch> {
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

// Percentile-stretch three source bands into RGBA pixels on the given ImageData.
export function renderChannels(
  patch: ReviewPatch,
  preset: ChannelPreset,
  target: Uint8ClampedArray,
): void {
  const { width, height, bands } = patch
  const n = width * height
  const [ri, gi, bi] = preset.bands
  const selected = [bands[ri], bands[gi], bands[bi]]

  // Shared percentile stretch across the three shown bands (matches TifUploadTab preview).
  const combined = new Float32Array(n * 3)
  selected.forEach((band, i) => combined.set(band, i * n))
  const sorted = Float32Array.from(combined).sort()
  const p5 = sorted[Math.floor(sorted.length * 0.02)]
  const p95 = sorted[Math.floor(sorted.length * 0.98)]
  const range = p95 - p5 || 1

  const stretch = (v: number) => Math.round(Math.max(0, Math.min(1, (v - p5) / range)) * 255)

  for (let i = 0; i < n; i++) {
    target[i * 4 + 0] = stretch(selected[0][i])
    target[i * 4 + 1] = stretch(selected[1][i])
    target[i * 4 + 2] = stretch(selected[2][i])
    target[i * 4 + 3] = 255
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
    super("Sitzung abgelaufen — bitte erneut anmelden.")
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
}

export async function submitReview(sub: ReviewSubmission): Promise<void> {
  const form = new FormData()
  form.append("tile_id", sub.tileId)
  form.append("verdict", sub.verdict)
  form.append("width", String(sub.width))
  form.append("height", String(sub.height))
  form.append("changed_pixels", String(sub.changedPixels ?? 0))
  if (sub.reviewer) form.append("reviewer", sub.reviewer)
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
