import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CHANNEL_PRESETS,
  countChangedPixels,
  fetchCoverageIndex,
  fetchTileIndex,
  loadPatch,
  maskCoverage,
  prefetchPatch,
  renderChannels,
  submitReview,
} from "../utils/review"
import { SessionExpiredError } from "../utils/review"
import type { ChannelPreset, CoverageIndex, ReviewPatch, Verdict } from "../utils/review"

type Tool = "add" | "remove"
type Status = "loading" | "ready" | "submitting"

const DEFAULT_OVERLAY_ALPHA = 0.45
const DEFAULT_MIN_COVERAGE = 1 // %, 0 = show every positive tile (no filter)
const MAX_MIN_COVERAGE = 20    // slider ceiling (only a handful of tiles exceed this)

interface ExpertReviewTabProps {
  reviewer?: string // omitted for anonymous guest reviews
  token?: string    // omitted for anonymous guest reviews
  onSessionExpired: () => void
}

export function ExpertReviewTab({ reviewer, token, onSessionExpired }: ExpertReviewTabProps) {
  const [tiles, setTiles] = useState<string[] | null>(null)
  const [patch, setPatch] = useState<ReviewPatch | null>(null)
  const [status, setStatus] = useState<Status>("loading")
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState<ChannelPreset>(CHANNEL_PRESETS[0])
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
  const [changedTotal, setChangedTotal] = useState(0)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nextTileRef = useRef<string | null>(null) // tile prefetched for the next Submit/Skip
  const bgRef = useRef<Uint8ClampedArray | null>(null) // background RGBA, w*h*4
  const maskRef = useRef<Uint8Array | null>(null)       // editable mask
  const paintingRef = useRef(false)
  const toolRef = useRef<Tool>(tool)
  const brushRef = useRef(brush)
  const overlayAlphaRef = useRef(overlayAlpha)
  const minCoverageRef = useRef(minCoverage)
  const coverageIndexRef = useRef(coverageIndex)
  toolRef.current = tool
  brushRef.current = brush
  overlayAlphaRef.current = overlayAlpha
  minCoverageRef.current = minCoverage
  coverageIndexRef.current = coverageIndex

  // ── Load the tile index (+ coverage) once ─────────────────────────────────
  useEffect(() => {
    fetchTileIndex()
      .then(async ({ tiles: list, coverage }) => {
        if (list.length === 0) throw new Error("No positive tiles available to review.")
        // Prefer coverage from inputs_index.csv (written by the data pipeline).
        // Until the next scan re-exports it, fall back to the shipped static
        // coverage_index.json so the filter still works today.
        const index =
          Object.keys(coverage).length > 0 ? coverage : await fetchCoverageIndex()
        setTiles(list)
        setCoverageIndex(index)
        coverageIndexRef.current = index // ref lags a render; loadRandom needs it now
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

  // Choose the tile that follows `current` and start downloading it now, so the
  // next Submit/Skip renders from memory instead of waiting on the network.
  function queueNext(list: string[], current: string) {
    const pool = eligibleTiles(list, minCoverageRef.current, coverageIndexRef.current)
    const next = pool.length > 0 ? pickFrom(pool, current) : null
    nextTileRef.current = next
    if (next) prefetchPatch(next)
  }

  // Load a random eligible tile. Coverage is now known up front from the index,
  // so exactly one tile is fetched — no scanning through the dataset.
  async function loadRandom(list: string[]) {
    const min = minCoverageRef.current
    const pool = eligibleTiles(list, min, coverageIndexRef.current)
    if (pool.length === 0) {
      setNotice(`No tile has ≥ ${min}% windthrow coverage — lower the filter.`)
      return // keep the current tile on screen
    }

    setStatus("loading")
    setError(null)
    setNotice(null)
    setDirty(false)
    setChangedPixels(0)

    // Take the prefetched tile when it still passes the current filter (the
    // coverage slider may have moved since it was queued), else pick a fresh one.
    const current = patch?.tileId
    const queued = nextTileRef.current
    const next =
      queued && queued !== current && pool.includes(queued) ? queued : pickFrom(pool, current)
    nextTileRef.current = null

    try {
      const p = await loadPatch(next)
      maskRef.current = Uint8Array.from(p.mask)
      setPatch(p)
      setCoverage(maskCoverage(p.mask))
      setStatus("ready")
      queueNext(list, next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus("ready")
    }
  }

  // ── Recompute the background whenever the patch or channel preset changes ──
  useEffect(() => {
    if (!patch) return
    const bg = new Uint8ClampedArray(patch.width * patch.height * 4)
    renderChannels(patch, preset, bg)
    bgRef.current = bg
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patch, preset])

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
    const id = setTimeout(() => void loadRandom(tiles), 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minCoverage])

  // How many tiles the current filter admits (from the coverage index), shown
  // next to the slider. null while the index is unavailable.
  const matchCount = useMemo(() => {
    const values = Object.values(coverageIndex)
    if (values.length === 0) return null
    return minCoverage <= 0 ? values.length : values.filter(c => c >= minCoverage).length
  }, [coverageIndex, minCoverage])

  function redraw() {
    const canvas = canvasRef.current
    const bg = bgRef.current
    const mask = maskRef.current
    if (!canvas || !bg || !mask || !patch) return
    const { width: w, height: h } = patch
    const ctx = canvas.getContext("2d")!
    const img = ctx.createImageData(w, h)
    const d = img.data
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      if (mask[i]) {
        const a = overlayAlphaRef.current
        d[o] = bg[o] * (1 - a) + 255 * a
        d[o + 1] = bg[o + 1] * (1 - a)
        d[o + 2] = bg[o + 2] * (1 - a)
      } else {
        d[o] = bg[o]
        d[o + 1] = bg[o + 1]
        d[o + 2] = bg[o + 2]
      }
      d[o + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }

  // ── Painting ──────────────────────────────────────────────────────────────
  function paintAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current
    const mask = maskRef.current
    if (!canvas || !mask || !patch) return
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

  function handlePointerDown(e: React.PointerEvent) {
    if (status !== "ready") return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    paintingRef.current = true
    paintAt(e.clientX, e.clientY)
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (paintingRef.current) paintAt(e.clientX, e.clientY)
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
      })
      setReviewedCount(c => c + 1)
      setChangedTotal(t => t + changed)
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
  function handleNoChange() {
    if (!patch) return
    send("confirmed", patch.mask)
  }
  function handleSubmit() {
    if (!patch || !maskRef.current) return
    send(dirty ? "edited" : "confirmed", maskRef.current)
  }
  function handleSkip() {
    if (tiles) void loadRandom(tiles)
  }

  const busy = status !== "ready"

  return (
    <div className="review-tab">
      <div className="review-titlebar">
        <h2>Edit patch</h2>
        <span className="review-meta">
          {reviewedCount > 0 && (
            <>{reviewedCount} reviewed &middot; {changedTotal.toLocaleString("en-US")} px changed &middot; </>
          )}
          {patch ? <code>{patch.tileId}</code> : "—"}
        </span>
      </div>

      {error && <div className="error-box">{error}</div>}

      {/* Channel + brush toolbar */}
      <div className="review-toolbar">
        <div className="review-toolbar-group">
          <span className="review-toolbar-label">Channels</span>
          {CHANNEL_PRESETS.map(p => (
            <button
              key={p.id}
              className={`tab-btn ${preset.id === p.id ? "tab-btn-active" : ""}`}
              onClick={() => setPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="review-toolbar-group">
          <span className="review-toolbar-label">Brush {brush}px</span>
          <input
            type="range"
            min={1}
            max={20}
            value={brush}
            onChange={e => setBrush(Number(e.target.value))}
          />
          <span className="review-toolbar-label">Opacity {Math.round(overlayAlpha * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(overlayAlpha * 100)}
            onChange={e => setOverlayAlpha(Number(e.target.value) / 100)}
          />
          <span className="review-coverage">Coverage {coverage.toFixed(1)}%</span>
          <span className="review-coverage">Changed {changedPixels.toLocaleString("en-US")} px</span>
          <button className="tab-btn" onClick={handleReset} disabled={!dirty || busy}>
            Reset mask
          </button>
        </div>
        <div className="review-toolbar-group">
          <span className="review-toolbar-label">
            Min. windthrow {minCoverage === 0 ? "off" : `${minCoverage.toFixed(1)}%`}
          </span>
          <input
            type="range"
            min={0}
            max={MAX_MIN_COVERAGE}
            step={0.1}
            value={minCoverage}
            title="Only show tiles whose proposed windthrow covers at least this share of the image"
            onChange={e => setMinCoverage(Number(e.target.value))}
            disabled={busy}
          />
          {matchCount !== null && (
            <span className="review-coverage">{matchCount} tiles</span>
          )}
        </div>
      </div>

      {notice && <div className="review-notice">{notice}</div>}

      {/* Main editing area: reject | canvas | submit */}
      <div className="review-stage">
        <button
          className="review-side-btn review-reject"
          onClick={handleNoWindthrow}
          disabled={busy}
        >
          No<br />windthrow
        </button>

        <div className="review-canvas-wrap">
          {status === "loading" && (
            <div className="review-canvas-loading">
              <div className="spinner" />
              <p>Loading patch…(Can take a moment for the first image)</p>
            </div>
          )}
          <canvas
            ref={canvasRef}
            width={patch?.width ?? 256}
            height={patch?.height ?? 256}
            className={`review-canvas review-tool-${tool}`}
            style={{ visibility: status === "loading" ? "hidden" : "visible" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endPaint}
            onPointerLeave={endPaint}
          />
        </div>

        <button
          className="review-side-btn review-submit"
          onClick={handleSubmit}
          disabled={busy}
        >
          {status === "submitting" ? "…" : "Submit"}
        </button>
      </div>

      {/* Bottom row: no-change | remove tool | add tool */}
      <div className="review-tools">
        <button className="review-tool-btn review-nochange" onClick={handleNoChange} disabled={busy}>
          No change needed
        </button>
        <button
          className={`review-tool-btn review-remove ${tool === "remove" ? "review-tool-active" : ""}`}
          onClick={() => setTool("remove")}
        >
          Remove pixels
        </button>
        <button
          className={`review-tool-btn review-add ${tool === "add" ? "review-tool-active" : ""}`}
          onClick={() => setTool("add")}
        >
          Add pixels
        </button>
      </div>

      <div className="review-footer-row">
        <button className="tab-btn" onClick={handleSkip} disabled={busy}>
          Skip → next random tile
        </button>
      </div>
    </div>
  )
}
