import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  BAND_LABELS,
  countChangedPixels,
  fetchCoverageIndex,
  fetchReviewSummary,
  fetchTileIndex,
  loadPatch,
  maskCoverage,
  prefetchPatch,
  submitReview,
} from "../utils/review"
import { SessionExpiredError } from "../utils/review"
import type { CoverageIndex, ReviewPatch, ReviewSummary, TileMetaIndex, Verdict } from "../utils/review"
import { allPresets, BUILTIN_PRESETS, formatValue, probePanel, renderPanel } from "../utils/channels"
import type { ChannelPanel, ChannelPreset, PanelStats, PixelProbe } from "../utils/channels"
import { bboxCenter, formatAcquisition, formatLatLon, mapsUrl } from "../utils/geo"
import { IMAGERY } from "../constants"
import { useAppState } from "../state/appStateContext"
import { Colorbar } from "./Colorbar"
import { HelpModal } from "./HelpModal"
import type { HelpSection } from "./HelpModal"

type Tool = "add" | "remove"
type Status = "loading" | "ready" | "submitting"
// Why a tile was picked (F8 tiered sampling): 1 = nobody has reviewed it yet,
// 2 = exactly one review so far (a second opinion), 3 = two+ reviews, none by
// me, 4 = I already reviewed it (last resort, when nothing else qualifies).
type PickTier = 1 | 2 | 3 | 4

const DEFAULT_OVERLAY_ALPHA = 0.45
const DEFAULT_MIN_COVERAGE = 1 // %, 0 = show every positive tile (no filter)
const MAX_MIN_COVERAGE = 20    // slider ceiling (only a handful of tiles exceed this)
const HELP_SEEN_KEY = "windthrowai.helpSeen.v1"
// Inside tier 1, half the time narrow the pick to the tiles the classifier was
// least confident about, so uncertain cases don't wait for a random draw.
const LOW_CONF_FRACTION = 0.2
const LOW_CONF_PROBABILITY = 0.5
// Share of picks drawn from the spot-check tiles (tiles the classifier
// rejected, see TileKind). 1 in 10 keeps them frequent enough that a
// retraining round's test split holds some, without turning review into
// scanning empty forest. Uniform within the spot-check pool on purpose: a
// random sample is what makes the measured miss rate an honest estimate.
const CONTROL_PICK_PROBABILITY = 0.1

function pickTierLabel(tier: PickTier | null, isControl: boolean): string | null {
  if (isControl) return "spot check"
  switch (tier) {
    case 1: return "new tile"
    case 2:
    case 3: return "second opinion"
    case 4: return "already reviewed"
    default: return null
  }
}

interface ExpertReviewTabProps {
  reviewer?: string // omitted for anonymous guest reviews
  token?: string    // omitted for anonymous guest reviews
  onSessionExpired: () => void
  onOpenChannels: () => void
}

export function ExpertReviewTab({ reviewer, token, onSessionExpired, onOpenChannels }: ExpertReviewTabProps) {
  const { setPatch: setSharedPatch, customPresets } = useAppState()

  const [tiles, setTiles] = useState<string[] | null>(null)
  const [tileMeta, setTileMeta] = useState<TileMetaIndex>({})
  const [patch, setPatch] = useState<ReviewPatch | null>(null)
  const [status, setStatus] = useState<Status>("loading")
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState<ChannelPreset>(BUILTIN_PRESETS[0])
  const [tool, setTool] = useState<Tool>("add")
  const [brush, setBrush] = useState(4)
  const [overlayAlpha, setOverlayAlpha] = useState(DEFAULT_OVERLAY_ALPHA)
  const [minCoverage, setMinCoverage] = useState(DEFAULT_MIN_COVERAGE)
  const [coverageIndex, setCoverageIndex] = useState<CoverageIndex>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [coverage, setCoverage] = useState(0)
  const [changedPixels, setChangedPixels] = useState(0)
  const [reviewedCount, setReviewedCount] = useState(0)
  const [probe, setProbe] = useState<{ panelId: string; x: number; y: number; data: PixelProbe } | null>(null)
  const [scanId, setScanId] = useState<string | undefined>(undefined) // export round, from inputs_index.csv
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary>({})
  const [pickTier, setPickTier] = useState<PickTier | null>(null) // why the current tile was picked (F8)
  const [controlTiles, setControlTiles] = useState<string[]>([]) // spot-check pool (see TileKind)

  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map()) // one canvas per panel
  const nextTileRef = useRef<string | null>(null) // tile prefetched for the next Submit/Skip
  const nextTierRef = useRef<PickTier | null>(null) // that prefetched tile's pick tier
  const bgMapRef = useRef<Map<string, Uint8ClampedArray>>(new Map()) // background RGBA per panel, w*h*4
  const maskRef = useRef<Uint8Array | null>(null)       // editable mask, shared across every panel
  const paintingRef = useRef(false)
  const toolRef = useRef<Tool>(tool)
  const brushRef = useRef(brush)
  const overlayAlphaRef = useRef(overlayAlpha)
  const minCoverageRef = useRef(minCoverage)
  const coverageIndexRef = useRef(coverageIndex)
  const tileMetaRef = useRef(tileMeta)
  const reviewSummaryRef = useRef(reviewSummary)
  const controlTilesRef = useRef(controlTiles)
  toolRef.current = tool
  brushRef.current = brush
  overlayAlphaRef.current = overlayAlpha
  minCoverageRef.current = minCoverage
  coverageIndexRef.current = coverageIndex
  tileMetaRef.current = tileMeta
  reviewSummaryRef.current = reviewSummary
  controlTilesRef.current = controlTiles

  const allPresetsList = useMemo(() => allPresets(customPresets), [customPresets])

  // If the active preset was a custom one that got deleted on the Channels
  // page, fall back to the first built-in rather than leaving a dangling id.
  // Computed during render (not an effect) so there's no extra render pass.
  const activePreset = allPresetsList.some(p => p.id === preset.id) ? preset : BUILTIN_PRESETS[0]

  // ── Help modal: auto-open once per browser, fail closed on storage errors ──
  // Lazy initializer runs exactly once at mount, so no effect + extra render is needed.
  const [helpSection, setHelpSection] = useState<HelpSection | null>(() => {
    try {
      return localStorage.getItem(HELP_SEEN_KEY) ? null : "overview"
    } catch {
      return null // storage blocked — never auto-open
    }
  })

  function openHelp(section: HelpSection) {
    setHelpSection(section)
  }
  function closeHelp() {
    setHelpSection(null)
    try {
      localStorage.setItem(HELP_SEEN_KEY, "1")
    } catch {
      // degrade silently
    }
  }

  // ── Load the tile index (+ coverage + review summary) once ────────────────
  useEffect(() => {
    // fetchReviewSummary() never rejects (it swallows its own errors and
    // resolves to {}), so a summary outage can't fail this Promise.all — the
    // tiered picker below just sees every tile as unreviewed, i.e. today's
    // uniform-random behaviour.
    Promise.all([fetchTileIndex(), fetchReviewSummary()])
      .then(async ([{ tiles: list, controlTiles: controls, meta, coverage, scanId: id }, summary]) => {
        if (list.length === 0) throw new Error("No positive tiles available to review.")
        // Prefer coverage from inputs_index.csv (written by the data pipeline).
        // Until the next scan re-exports it, fall back to the shipped static
        // coverage_index.json so the filter still works today.
        const index =
          Object.keys(coverage).length > 0 ? coverage : await fetchCoverageIndex()
        setTiles(list)
        setTileMeta(meta)
        setCoverageIndex(index)
        setScanId(id)
        setReviewSummary(summary)
        setControlTiles(controls)
        // refs lag a render; loadRandom needs today's values right now
        coverageIndexRef.current = index
        tileMetaRef.current = meta
        reviewSummaryRef.current = summary
        controlTilesRef.current = controls
        void loadRandom(list)
      })
      .catch(e => {
        setError(e instanceof Error ? e.message : String(e))
        setStatus("ready")
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const computeCoverage = useCallback((mask: Uint8Array) => {
    setCoverage(maskCoverage(mask))
  }, [])

  // Pixels changed vs. the proposed mask of the tile currently under review.
  function changedVsProposed(mask: Uint8Array): number {
    return patch ? countChangedPixels(patch.mask, mask) : 0
  }

  // Tiles whose precomputed windthrow coverage meets the current filter. When
  // the coverage index is unavailable (empty), every tile is eligible so the
  // review flow still works — just without pre-filtering.
  function eligibleTiles(list: string[], min: number, index: CoverageIndex): string[] {
    if (min <= 0 || Object.keys(index).length === 0) return list
    return list.filter(t => (index[t] ?? -1) >= min)
  }

  // Pick a random tile from the pool, avoiding an immediate repeat of `current`.
  function pickFrom(pool: string[], current?: string): string {
    const candidates = current && pool.length > 1 ? pool.filter(t => t !== current) : pool
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  // Tiered tile selection (F8): spend reviewer time where it counts instead of
  // a uniform draw. Tiles nobody has reviewed go first, then a second opinion
  // for the tiles pull_data's consensus needs one more vote on, then anything
  // else not reviewed by this reviewer, and reviewed-by-me tiles only as a
  // last resort. An empty/unavailable `summary` (fetch failure, or genuinely
  // no reviews yet) makes every tile tier 1, which is exactly the old uniform
  // pick among the whole pool — so this degrades safely with no special case.
  function pickTiered(
    pool: string[],
    current: string | undefined,
    summary: ReviewSummary,
    meta: TileMetaIndex,
    preferUncertain = true,
  ): { tileId: string; tier: PickTier } {
    const candidates = current && pool.length > 1 ? pool.filter(t => t !== current) : pool
    const countOf = (t: string) => summary[t]?.n ?? 0
    const reviewedByMe = (t: string) => !!reviewer && (summary[t]?.reviewers.includes(reviewer) ?? false)

    const tier1 = candidates.filter(t => !reviewedByMe(t) && countOf(t) === 0)
    if (tier1.length > 0) {
      if (!preferUncertain) return { tileId: pickFrom(tier1), tier: 1 }
      const byConfidence = tier1
        .filter(t => meta[t]?.clfProb !== undefined)
        .sort((a, b) => meta[a].clfProb! - meta[b].clfProb!)
      if (byConfidence.length > 0 && Math.random() < LOW_CONF_PROBABILITY) {
        const n = Math.max(1, Math.ceil(byConfidence.length * LOW_CONF_FRACTION))
        return { tileId: pickFrom(byConfidence.slice(0, n)), tier: 1 }
      }
      return { tileId: pickFrom(tier1), tier: 1 }
    }

    const tier2 = candidates.filter(t => !reviewedByMe(t) && countOf(t) === 1)
    if (tier2.length > 0) return { tileId: pickFrom(tier2), tier: 2 }

    const tier3 = candidates.filter(t => !reviewedByMe(t) && countOf(t) >= 2)
    if (tier3.length > 0) return { tileId: pickFrom(tier3), tier: 3 }

    return { tileId: pickFrom(candidates), tier: 4 }
  }

  // One pick: a spot-check tile with probability CONTROL_PICK_PROBABILITY, else
  // a flagged tile that passes the coverage filter (which never applies to spot
  // checks — their coverage is 0 by construction). null when nothing qualifies.
  function pickNext(list: string[], current: string | undefined): { tileId: string; tier: PickTier } | null {
    const controls = controlTilesRef.current
    if (controls.length > 0 && Math.random() < CONTROL_PICK_PROBABILITY) {
      return pickTiered(controls, current, reviewSummaryRef.current, tileMetaRef.current, false)
    }
    const pool = eligibleTiles(list, minCoverageRef.current, coverageIndexRef.current)
    if (pool.length === 0) return null
    return pickTiered(pool, current, reviewSummaryRef.current, tileMetaRef.current)
  }

  // Choose the tile that follows `current` and start downloading it now, so the
  // next Submit/Skip renders from memory instead of waiting on the network.
  function queueNext(list: string[], current: string) {
    const picked = pickNext(list, current)
    if (!picked) {
      nextTileRef.current = null
      nextTierRef.current = null
      return
    }
    const { tileId: next, tier } = picked
    nextTileRef.current = next
    nextTierRef.current = tier
    prefetchPatch(next)
  }

  // Load a random eligible tile. Coverage is now known up front from the index,
  // so exactly one tile is fetched — no scanning through the dataset.
  async function loadRandom(list: string[]) {
    const min = minCoverageRef.current
    const pool = eligibleTiles(list, min, coverageIndexRef.current)
    if (pool.length === 0) {
      setNotice(`No tile has ≥ ${min}% windthrow coverage — lower the filter.`)
      setStatus("ready") // keep the current tile on screen, but don't leave the UI stuck
      return
    }

    setStatus("loading")
    setError(null)
    setNotice(null)
    setDirty(false)
    setChangedPixels(0)

    // Take the prefetched tile when it still passes the current filter (the
    // coverage slider may have moved since it was queued; a queued spot check
    // is exempt from it), else pick a fresh one.
    const current = patch?.tileId
    const queued = nextTileRef.current
    let next: string
    let tier: PickTier
    if (queued && queued !== current && (pool.includes(queued) || controlTilesRef.current.includes(queued))) {
      next = queued
      tier = nextTierRef.current ?? 1
    } else {
      // pool is non-empty here, so the flagged branch of pickNext always has a candidate
      const picked = pickNext(list, current) ?? pickTiered(pool, current, reviewSummaryRef.current, tileMetaRef.current)
      next = picked.tileId
      tier = picked.tier
    }
    nextTileRef.current = null
    nextTierRef.current = null

    try {
      const p = await loadPatch(next)
      maskRef.current = Uint8Array.from(p.mask)
      setPatch(p)
      setSharedPatch(p)
      setCoverage(maskCoverage(p.mask))
      setPickTier(tier)
      setStatus("ready")
      queueNext(list, next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus("ready")
    }
  }

  // ── The background composites, one per panel ────────────────────────────────
  // Pure in (patch, preset), so it's derived rather than pushed into state by
  // an effect. A custom preset can carry a formula that no longer compiles (a
  // half-finished edit saved, a band renamed); that's reported next to that
  // panel's own canvas and its previous frame stays up, instead of taking the
  // whole page down.
  const background = useMemo(() => {
    if (!patch) return null
    const out: Record<string, { bg: Uint8ClampedArray | null; stats: PanelStats | null; error: string | null }> = {}
    for (const panel of activePreset.panels) {
      const bg = new Uint8ClampedArray(patch.width * patch.height * 4)
      try {
        out[panel.id] = { bg, stats: renderPanel(patch, panel, bg), error: null }
      } catch (e) {
        out[panel.id] = { bg: null, stats: null, error: e instanceof Error ? e.message : String(e) }
      }
    }
    return out
  }, [patch, activePreset])

  useEffect(() => {
    if (background) {
      for (const [id, r] of Object.entries(background)) {
        if (r.bg) bgMapRef.current.set(id, r.bg)
      }
    }
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [background])

  // Redraw when the overlay opacity changes.
  useEffect(() => {
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayAlpha])

  // When the filter is raised past the current tile's coverage, pull a new
  // qualifying tile. Debounced so dragging the slider fires just one load.
  useEffect(() => {
    if (!tiles || status !== "ready") return
    if (minCoverage <= 0 || coverage >= minCoverage) return
    if (patch && tileMeta[patch.tileId]?.kind === "control") return // spot checks ignore the filter
    const id = setTimeout(() => void loadRandom(tiles), 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minCoverage])

  // How many tiles the current filter admits (from the coverage index), shown
  // next to the slider. null while the index is unavailable.
  const totalCount = useMemo(() => Object.values(coverageIndex).length, [coverageIndex])
  const matchCount = useMemo(() => {
    const values = Object.values(coverageIndex)
    if (values.length === 0) return null
    return minCoverage <= 0 ? values.length : values.filter(c => c >= minCoverage).length
  }, [coverageIndex, minCoverage])
  const lowMatchNote =
    matchCount !== null && minCoverage <= 1 && matchCount < totalCount * 0.5

  function redraw() {
    const mask = maskRef.current
    if (!mask || !patch) return
    const { width: w, height: h } = patch
    const a = overlayAlphaRef.current
    for (const panel of activePreset.panels) {
      const canvas = canvasRefs.current.get(panel.id)
      const bg = bgMapRef.current.get(panel.id)
      if (!canvas || !bg) continue
      const ctx = canvas.getContext("2d")!
      const img = ctx.createImageData(w, h)
      const d = img.data
      for (let i = 0; i < w * h; i++) {
        const o = i * 4
        if (mask[i]) {
          d[o] = bg[o] * (1 - a) + 255 * a
          d[o + 1] = bg[o + 1] * (1 - a)
          d[o + 2] = bg[o + 2] * (1 - a)
          d[o + 3] = 255 // the mask stays visible even over a no-data pixel
        } else {
          d[o] = bg[o]
          d[o + 1] = bg[o + 1]
          d[o + 2] = bg[o + 2]
          d[o + 3] = bg[o + 3] // 0 where the formula had no data — let the hatch show
        }
      }
      ctx.clearRect(0, 0, w, h)
      ctx.putImageData(img, 0, 0)
    }
  }

  // ── Painting ──────────────────────────────────────────────────────────────
  // A stroke is anchored to whichever panel's canvas the pointer went down on
  // (pointer capture keeps delivering move/up events to that same canvas), but
  // it writes into the one mask shared by every panel, so every other panel's
  // view redraws with it too.
  function paintAt(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const mask = maskRef.current
    if (!mask || !patch) return
    const { width: w, height: h } = patch
    const rect = canvas.getBoundingClientRect()
    const px = Math.floor(((clientX - rect.left) / rect.width) * w)
    const py = Math.floor(((clientY - rect.top) / rect.height) * h)
    const r = brushRef.current
    const val = toolRef.current === "add" ? 1 : 0
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue
        const x = px + dx
        const y = py + dy
        if (x < 0 || y < 0 || x >= w || y >= h) continue
        mask[y * w + x] = val
      }
    }
    if (!dirty) setDirty(true)
    redraw()
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (status !== "ready") return
    e.currentTarget.setPointerCapture(e.pointerId)
    paintingRef.current = true
    paintAt(e.currentTarget, e.clientX, e.clientY)
  }
  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>, panel: ChannelPanel) {
    if (paintingRef.current) paintAt(e.currentTarget, e.clientX, e.clientY)
    updateProbe(e.currentTarget, panel, e.clientX, e.clientY)
  }

  // ── Pixel probe ───────────────────────────────────────────────────────────
  // Reads out the actual numbers under the cursor, for whichever panel it's
  // hovering. Especially worth having on an index view: it's how a reviewer
  // checks that the colour they're about to act on corresponds to the value
  // they think it does.
  function updateProbe(canvas: HTMLCanvasElement, panel: ChannelPanel, clientX: number, clientY: number) {
    if (!patch) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor(((clientX - rect.left) / rect.width) * patch.width)
    const y = Math.floor(((clientY - rect.top) / rect.height) * patch.height)
    if (x < 0 || y < 0 || x >= patch.width || y >= patch.height) return
    try {
      setProbe({ panelId: panel.id, x, y, data: probePanel(patch, panel, y * patch.width + x) })
    } catch {
      setProbe(null) // broken formula — that panel's own error box already says so
    }
  }
  function endPaint() {
    if (!paintingRef.current) return
    paintingRef.current = false
    if (maskRef.current) {
      computeCoverage(maskRef.current)
      setChangedPixels(changedVsProposed(maskRef.current))
    }
  }

  function handleReset() {
    if (!patch) return
    maskRef.current = Uint8Array.from(patch.mask)
    setDirty(false)
    setChangedPixels(0)
    computeCoverage(patch.mask)
    redraw()
  }

  // Reflect a just-submitted review in the in-memory summary immediately,
  // rather than waiting ~60s for the backend's own cache to catch up — the
  // tiered picker (pickTiered) reads this on every subsequent pick.
  function recordReviewLocally(tileId: string) {
    setReviewSummary(prev => {
      const entry = prev[tileId] ?? { n: 0, reviewers: [] }
      const reviewers =
        reviewer && !entry.reviewers.includes(reviewer) ? [...entry.reviewers, reviewer] : entry.reviewers
      const next = { ...prev, [tileId]: { n: entry.n + 1, reviewers } }
      reviewSummaryRef.current = next
      return next
    })
  }

  // ── Submitting ────────────────────────────────────────────────────────────
  async function send(verdict: Verdict, mask: Uint8Array) {
    if (!patch || !tiles) return
    setStatus("submitting")
    setError(null)
    const changed = changedVsProposed(mask)
    try {
      await submitReview({
        tileId: patch.tileId,
        verdict,
        mask,
        width: patch.width,
        height: patch.height,
        changedPixels: changed,
        reviewer,
        token,
        scanId,
        tileKind: isControl ? "control" : "flagged",
      })
      setReviewedCount(c => c + 1)
      recordReviewLocally(patch.tileId)
      await loadRandom(tiles)
    } catch (e) {
      if (e instanceof SessionExpiredError) {
        onSessionExpired()
        return
      }
      setError(e instanceof Error ? e.message : String(e))
      setStatus("ready")
    }
  }

  function handleNoWindthrow() {
    if (!patch) return
    send("no_windthrow", new Uint8Array(patch.width * patch.height)) // empty mask = false positive
  }
  function handleSubmit() {
    if (!patch || !maskRef.current) return
    if (isControl) {
      // A spot check has one question: did the model miss windthrow here? Any
      // painted pixel means yes ("edited", the drawn mask); none means the
      // model was right, recorded as a plain "no_windthrow" with an empty mask.
      const found = maskRef.current.some(v => v !== 0)
      send(found ? "edited" : "no_windthrow", found ? maskRef.current : new Uint8Array(patch.width * patch.height))
      return
    }
    send(dirty ? "edited" : "confirmed", maskRef.current)
  }
  function handleSkip() {
    if (tiles) void loadRandom(tiles)
  }

  const busy = status !== "ready"

  const meta = patch ? tileMeta[patch.tileId] : undefined
  const isControl = meta?.kind === "control"
  const center = bboxCenter(meta)
  const acq = formatAcquisition(meta)
  const tierLabel = pickTierLabel(pickTier, isControl)

  return (
    <div className="review-tab">
      <div className="review-titlebar">
        <div className="review-title-left">
          <h2>Review this tile</h2>
          <button
            className="help-btn help-btn-primary"
            onClick={() => openHelp("overview")}
            aria-label="How this page works"
            title="How this page works"
          >
            ℹ️
          </button>
        </div>

        <div className="review-tile-info">
          {center ? (
            <a
              className="review-coord"
              href={mapsUrl(center)}
              target="_blank"
              rel="noreferrer"
              title={patch ? `Tile ${patch.tileId} — open in Google Maps` : undefined}
            >
              {formatLatLon(center)} ↗
            </a>
          ) : (
            <span className="review-coord review-coord-unknown">Location unavailable</span>
          )}
          <span
            className={`review-acq ${acq.exact ? "" : "review-acq-approx"}`}
            title={
              acq.exact
                ? undefined
                : "Acquisition window the scan searched — this tile carries no per-scene date"
            }
          >
            {IMAGERY.sensor} · {acq.text}
          </span>
          {tierLabel && (
            <span
              className={`review-tier-label ${isControl ? "review-tier-label-control" : ""}`}
              title={
                isControl
                  ? "A random tile the model rejected — see the note below"
                  : "Why this tile was picked (F8 tiered sampling)"
              }
            >
              {tierLabel}
            </span>
          )}
        </div>
      </div>

      {reviewedCount > 0 && (
        <p className="review-session">
          {reviewedCount} tile{reviewedCount === 1 ? "" : "s"} reviewed this session
          {scanId && <span className="review-scan-id">· Round: {scanId}</span>}
        </p>
      )}

      {error && <div className="error-box">{error}</div>}

      {isControl && (
        <div className="review-control-banner" role="note">
          <div className="review-control-banner-head">
            <strong>🔍 Spot check: the model found no windthrow on this tile</strong>
            <button
              className="help-btn"
              onClick={() => openHelp("spotcheck")}
              aria-label="Why am I seeing a spot check?"
              title="Why am I seeing a spot check?"
            >
              ℹ️
            </button>
          </div>
          <p>
            That's why there is no red mask. This tile is part of a small random sample of tiles the
            model <em>rejected</em>, so please look at it as carefully as any other. Do you see
            windthrow anyway? Paint it with <strong>➕ Add pixels</strong> and save. If not, confirm
            that the model is right.
          </p>
        </div>
      )}

      {/* Your decision */}
      <section className="review-zone" role="group" aria-labelledby="decision-head">
        <div className="review-zone-head">
          <h3 id="decision-head">Your decision</h3>
          <button
            className="help-btn"
            onClick={() => openHelp("decision")}
            aria-label="Explain the decision buttons"
            title="Explain the decision buttons"
          >
            ℹ️
          </button>
        </div>

        <div className="review-decision">
          {isControl ? (
            <div className="review-decision-item">
              <button
                className="review-decision-btn review-decision-accept"
                onClick={handleSubmit}
                disabled={busy}
              >
                {status === "submitting"
                  ? "…"
                  : coverage > 0
                    ? "💾 Save: the model missed this"
                    : "✔️ No windthrow: model is right"}
              </button>
              <p className="review-decision-caption">
                {coverage > 0 ? "your red area is the missed windthrow" : "nothing to mark on this tile"}
              </p>
            </div>
          ) : (
            <>
              <div className="review-decision-item">
                <button
                  className="review-decision-btn review-decision-accept"
                  onClick={handleSubmit}
                  disabled={busy}
                >
                  {status === "submitting" ? "…" : dirty ? "💾 Save my corrections" : "✔️ Confirm mask"}
                </button>
                <p className="review-decision-caption">the mask is now right</p>
              </div>
              <div className="review-decision-item">
                <button
                  className="review-decision-btn review-decision-reject"
                  onClick={handleNoWindthrow}
                  disabled={busy}
                >
                  ❌ No windthrow here
                </button>
                <p className="review-decision-caption">the model was wrong</p>
              </div>
            </>
          )}
          <div className="review-decision-item">
            <button
              className="review-decision-btn review-decision-skip"
              onClick={handleSkip}
              disabled={busy}
            >
              ⏭️ Skip
            </button>
            <p className="review-decision-caption">unsure — show me another</p>
          </div>
        </div>
      </section>

      {notice && <div className="review-notice">{notice}</div>}

      {/* Canvas(es), centred and alone — one per layer in the active preset */}
      <div className="review-stage">
        <div className="review-canvas-area">
          {status === "loading" && (
            <div className="review-canvas-loading">
              <div className="spinner" />
              <p>Loading tile… the first one can take a few seconds</p>
            </div>
          )}
          <div className="channels-panel-grid review-canvas-grid">
            {activePreset.panels.map(panel => (
              <div className="channels-panel review-panel" key={panel.id}>
                <canvas
                  ref={el => {
                    if (el) canvasRefs.current.set(panel.id, el)
                    else canvasRefs.current.delete(panel.id)
                  }}
                  width={patch?.width ?? 256}
                  height={patch?.height ?? 256}
                  className={`channels-canvas review-canvas review-tool-${tool}`}
                  style={{ visibility: status === "loading" ? "hidden" : "visible" }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={e => handlePointerMove(e, panel)}
                  onPointerUp={endPaint}
                  onPointerLeave={() => {
                    endPaint()
                    setProbe(null)
                  }}
                />
                {activePreset.panels.length > 1 && (
                  <span className="channels-panel-label">{panel.label}</span>
                )}
                <Colorbar
                  panel={panel}
                  stats={background?.[panel.id]?.stats ?? null}
                  compact={activePreset.panels.length > 1}
                />
                {background?.[panel.id]?.error && (
                  <p className="channels-panel-error">
                    Didn't compile ({background[panel.id].error}) — showing the previous view.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="review-readout">
          {probe ? (
            <div className="channels-probe">
              <div className="channels-probe-head">
                <strong>
                  x {probe.x}, y {probe.y}
                  {activePreset.panels.length > 1 &&
                    ` · ${activePreset.panels.find(p => p.id === probe.panelId)?.label ?? ""}`}
                </strong>
                {probe.data.overlay && (
                  <span className={probe.data.overlay.hit ? "channels-probe-in-mask" : "channels-probe-out-mask"}>
                    {probe.data.overlay.hit ? "rule fires here" : "rule doesn't fire"}
                  </span>
                )}
              </div>
              <div className="channels-probe-bands">
                {BAND_LABELS.map((b, i) => (
                  <span key={b}>
                    <em>{b}</em> {formatValue(probe.data.bands[i])}
                  </span>
                ))}
                {probe.data.channels.map((c, i) => (
                  <span key={`c${i}`}>
                    <em>{c.label}</em> {formatValue(c.value)}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="channels-probe channels-probe-idle">
              Hover a tile to read the band values under the cursor.
            </p>
          )}
        </div>
      </div>

      {/* Correct the mask */}
      <section className="review-zone" role="group" aria-labelledby="correct-mask-head">
        <div className="review-zone-head">
          <h3 id="correct-mask-head">Correct the mask</h3>
          <button
            className="help-btn"
            onClick={() => openHelp("add")}
            aria-label="Explain the mask tools"
            title="Explain the mask tools"
          >
            ℹ️
          </button>
        </div>

        <div className="review-toolbar-group">
          <div className="review-segmented" role="group" aria-label="Paint mode">
            <button
              className={`review-segmented-btn ${tool === "add" ? "review-segmented-active" : ""}`}
              aria-pressed={tool === "add"}
              onClick={() => setTool("add")}
            >
              ➕ Add pixels
            </button>
            <button
              className={`review-segmented-btn ${tool === "remove" ? "review-segmented-active" : ""}`}
              aria-pressed={tool === "remove"}
              onClick={() => setTool("remove")}
            >
              🧹 Remove pixels
            </button>
          </div>
          <span className="review-toolbar-label">Brush {2 * brush + 1} px</span>
          <input
            type="range"
            min={1}
            max={20}
            value={brush}
            aria-label="Brush size"
            onChange={e => setBrush(Number(e.target.value))}
          />
        </div>

        <div className="review-toolbar-group">
          <span className="review-toolbar-label">Mask opacity {Math.round(overlayAlpha * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(overlayAlpha * 100)}
            aria-label="Mask opacity"
            onChange={e => setOverlayAlpha(Number(e.target.value) / 100)}
          />
          <span className="review-coverage">Marked: {coverage.toFixed(1)}% of tile</span>
        </div>

        <div className="review-toolbar-group">
          {changedPixels > 0 && (
            <span className="review-coverage" aria-live="polite">
              Your edits: {changedPixels.toLocaleString("en-US")} px
            </span>
          )}
          <button className="tab-btn" onClick={handleReset} disabled={!dirty || busy}>
            ↩️ Undo all edits
          </button>
        </div>
      </section>

      {/* Band combination toolbar */}
      <div className="review-toolbar" role="group" aria-labelledby="band-combo-label">
        <div className="review-toolbar-group">
          <span className="review-toolbar-label" id="band-combo-label">
            Band combination
          </span>
          {BUILTIN_PRESETS.map(p => (
            <button
              key={p.id}
              className={`tab-btn ${activePreset.id === p.id ? "tab-btn-active" : ""}`}
              onClick={() => setPreset(p)}
            >
              {p.label}
            </button>
          ))}
          {customPresets.length > 0 && (
            <select
              className="review-custom-select"
              value={customPresets.some(p => p.id === activePreset.id) ? activePreset.id : ""}
              onChange={e => {
                const found = customPresets.find(p => p.id === e.target.value)
                if (found) setPreset(found)
              }}
              aria-label="Custom band combination"
            >
              <option value="" disabled>
                Custom ▾
              </option>
              {customPresets.map(p => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          <button className="tab-btn" onClick={onOpenChannels}>
            🎨 Customize…
          </button>
          <button
            className="help-btn"
            onClick={() => openHelp("bands")}
            aria-label="Explain band combinations"
            title="Explain band combinations"
          >
            ℹ️
          </button>
        </div>
      </div>

      {/* Tile filter */}
      <div className="review-filter-row">
        <span className="review-toolbar-label">
          Show tiles with at least {minCoverage === 0 ? "0" : minCoverage.toFixed(1)}% windthrow
        </span>
        <input
          type="range"
          min={0}
          max={MAX_MIN_COVERAGE}
          step={0.1}
          value={minCoverage}
          aria-label="Minimum windthrow coverage filter"
          onChange={e => setMinCoverage(Number(e.target.value))}
          disabled={busy}
        />
        <button
          className="help-btn"
          onClick={() => openHelp("filter")}
          aria-label="Explain the tile filter"
          title="Explain the tile filter"
        >
          ℹ️
        </button>
        {matchCount !== null && (
          <span className="review-coverage">
            {matchCount} of {totalCount} tiles match
            {lowMatchNote && " (many tiles have stale/missing coverage data)"}
          </span>
        )}
      </div>

      {helpSection && (
        <HelpModal section={helpSection} onClose={closeHelp} onOpenChannels={onOpenChannels} />
      )}
    </div>
  )
}
