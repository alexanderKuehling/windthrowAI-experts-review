import { useCallback, useEffect, useRef, useState } from "react"
import { BandMathError, FUNC_HELP } from "../utils/bandmath"
import {
  applyRecipe,
  BUILTIN_PRESETS,
  DEFAULT_OVERLAY_ALPHA,
  DEFAULT_OVERLAY_COLOR,
  domainForColormap,
  emptyPanel,
  formatValue,
  newCustomId,
  newPanelId,
  probePanel,
  renderPanel,
  resolveDomain,
} from "../utils/channels"
import type {
  ChannelMode,
  ChannelPanel,
  ChannelPreset,
  Domain,
  PanelStats,
  PixelProbe,
} from "../utils/channels"
import { COLORMAPS, colormapGradient, getColormap } from "../utils/colormaps"
import type { ColormapId } from "../utils/colormaps"
import { newRecipeId, recipesOfKind } from "../utils/recipes"
import type { Recipe, RecipeKind } from "../utils/recipes"
import { BAND_LABELS, fetchCoverageIndex, fetchTileIndex, loadPatch, pickRandomTile } from "../utils/review"
import { useAppState } from "../state/appStateContext"
import { Colorbar } from "./Colorbar"

const BAND_OPTIONS = [...BAND_LABELS] as const
const CUSTOM_EXPR = "__custom__"

const BAND_REFERENCE: { id: string; meaning: string; landsat: string; range: string }[] = [
  { id: "R", meaning: "Red", landsat: "SR_B4", range: "≈ 0.0 – 0.6" },
  { id: "G", meaning: "Green", landsat: "SR_B3", range: "≈ 0.0 – 0.6" },
  { id: "B", meaning: "Blue", landsat: "SR_B2", range: "≈ 0.0 – 0.6" },
  { id: "nIR", meaning: "Near infrared", landsat: "SR_B5", range: "≈ 0.0 – 0.6" },
  { id: "swIR1", meaning: "Shortwave infrared 1", landsat: "SR_B6", range: "≈ 0.0 – 0.6" },
  { id: "swIR2", meaning: "Shortwave infrared 2", landsat: "SR_B7", range: "≈ 0.0 – 0.6" },
  { id: "NBR", meaning: "Normalized burn ratio (rescaled)", landsat: "derived", range: "0 – 1" },
]

function emptyPreset(): ChannelPreset {
  return {
    id: newCustomId(),
    label: "",
    panels: [emptyPanel()],
  }
}

function isBareBand(expr: string): boolean {
  return (BAND_OPTIONS as readonly string[]).some(b => b.toLowerCase() === expr.trim().toLowerCase())
}

/** "0.1, 0.25, 0.4" → [0.1, 0.25, 0.4]; anything unparseable is dropped. */
function parseBins(text: string): number[] {
  return text
    .split(",")
    .map(s => Number(s.trim()))
    .filter(v => Number.isFinite(v))
    .sort((a, b) => a - b)
}

interface Probe {
  panelId: string
  x: number
  y: number
  masked: boolean
  data: PixelProbe
}

export function ChannelsTab() {
  const {
    patch,
    setPatch,
    customPresets,
    setCustomPresets,
    customRecipes,
    setCustomRecipes,
    presetsSyncError,
  } = useAppState()

  const [editing, setEditing] = useState<ChannelPreset>(emptyPreset)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadingTile, setLoadingTile] = useState(false)
  const [tileError, setTileError] = useState<string | null>(null)
  const [showMask, setShowMask] = useState(false)
  const [activePanelId, setActivePanelId] = useState<string>(editing.panels[0].id)
  const [focusedChannel, setFocusedChannel] = useState(0)
  const [probe, setProbe] = useState<Probe | null>(null)
  // Rows the user explicitly switched to "Custom expression…", keyed by
  // `${panelId}:${channelIndex}`. Tracked separately from the expression text so
  // the input doesn't disappear while a formula is mid-edit (e.g. typing "R"
  // before the rest of the expression, which would otherwise read as a bare band).
  const [customRows, setCustomRows] = useState<Record<string, boolean>>({})

  const isBuiltin = !!BUILTIN_PRESETS.find(p => p.id === editing.id)
  const activePanel = editing.panels.find(p => p.id === activePanelId) ?? editing.panels[0]

  function updatePanel(panelId: string, patchFn: (p: ChannelPanel) => ChannelPanel) {
    setEditing(prev => ({
      ...prev,
      panels: prev.panels.map(p => (p.id === panelId ? patchFn(p) : p)),
    }))
  }

  function updateActive(patchFn: (p: ChannelPanel) => ChannelPanel) {
    updatePanel(activePanel.id, patchFn)
  }

  function addPanel() {
    const p = emptyPanel()
    setEditing(prev => ({ ...prev, panels: [...prev.panels, p] }))
    setActivePanelId(p.id)
  }

  function removePanel(panelId: string) {
    setEditing(prev => {
      if (prev.panels.length <= 1) return prev // always keep at least one layer
      const panels = prev.panels.filter(p => p.id !== panelId)
      if (activePanelId === panelId) setActivePanelId(panels[0].id)
      return { ...prev, panels }
    })
  }

  function duplicatePanel(panelId: string) {
    const src = editing.panels.find(p => p.id === panelId)
    if (!src) return
    const copy: ChannelPanel = { ...src, id: newPanelId(), label: src.label + " copy" }
    setEditing(prev => ({ ...prev, panels: [...prev.panels, copy] }))
    setActivePanelId(copy.id)
  }

  // ── Live preview: one canvas per panel ────────────────────────────────────
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map())
  const lastGoodRef = useRef<Map<string, Uint8ClampedArray>>(new Map())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [panelErrors, setPanelErrors] = useState<Record<string, string | null>>({})
  const [panelStats, setPanelStats] = useState<Record<string, PanelStats | null>>({})
  // Mirrors panelStats so a failed render can hold on to the numbers that go
  // with the frame still on screen, instead of blanking the legend.
  const statsRef = useRef<Record<string, PanelStats | null>>({})

  const renderNow = useCallback(() => {
    if (!patch) return
    const { width, height } = patch
    const errs: Record<string, string | null> = {}
    const stats: Record<string, PanelStats | null> = {}

    for (const panel of editing.panels) {
      const canvas = canvasRefs.current.get(panel.id)
      if (!canvas) continue
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")!

      const target = new Uint8ClampedArray(width * height * 4)
      try {
        stats[panel.id] = renderPanel(patch, panel, target)
        lastGoodRef.current.set(panel.id, target)
        errs[panel.id] = null
      } catch (e) {
        errs[panel.id] = e instanceof BandMathError ? e.message : e instanceof Error ? e.message : String(e)
        stats[panel.id] = statsRef.current[panel.id] ?? null
        // Freeze at the last valid render — never blank the canvas.
        const last = lastGoodRef.current.get(panel.id)
        ctx.clearRect(0, 0, width, height)
        if (last) ctx.putImageData(new ImageData(new Uint8ClampedArray(last), width, height), 0, 0)
        continue
      }

      if (showMask && patch.mask) {
        const alpha = 0.45
        for (let i = 0; i < width * height; i++) {
          if (patch.mask[i]) {
            const o = i * 4
            target[o] = target[o] * (1 - alpha) + 255 * alpha
            target[o + 1] = target[o + 1] * (1 - alpha)
            target[o + 2] = target[o + 2] * (1 - alpha)
            target[o + 3] = 255 // stay visible even over a no-data pixel
          }
        }
      }

      ctx.clearRect(0, 0, width, height) // no-data is transparent; don't stack frames
      ctx.putImageData(new ImageData(target, width, height), 0, 0)
    }
    setPanelErrors(errs)
    setPanelStats(stats)
    statsRef.current = stats
  }, [patch, editing, showMask])

  // ── Debounced live preview ────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      renderNow()
    }, 150)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [renderNow])

  // ── Tile loading ─────────────────────────────────────────────────────────
  async function loadSampleTile() {
    setLoadingTile(true)
    setTileError(null)
    try {
      const { tiles, coverage, meta } = await fetchTileIndex()
      if (tiles.length === 0) throw new Error("No tiles available.")
      const index = Object.keys(coverage).length > 0 ? coverage : await fetchCoverageIndex()
      const pool = Object.keys(index).length > 0 ? tiles.filter(t => (index[t] ?? -1) > 0) : tiles
      const id = pickRandomTile(pool.length > 0 ? pool : tiles)
      const p = await loadPatch(id, meta[id]?.nbrEncoding)
      setPatch(p)
    } catch (e) {
      setTileError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingTile(false)
    }
  }

  // ── Editor field updates (act on the active panel) ────────────────────────
  function updateChannel(i: number, expr: string) {
    updateActive(p => {
      const next: [string, string, string] = [...p.expressions]
      next[i] = expr
      return { ...p, expressions: next }
    })
  }

  function updatePanelLabel(label: string) {
    updateActive(p => ({ ...p, label }))
  }

  function setMode(mode: ChannelMode) {
    updateActive(p => {
      if (p.mode === mode) return p
      if (mode === "rgb") {
        // Carry the index formula into red and fill the other two with sane
        // bands rather than leaving them blank or duplicating the index.
        const [e0, e1, e2] = p.expressions
        return { ...p, mode, expressions: [e0, e1 || "G", e2 || "B"] }
      }
      return { ...p, mode }
    })
    setFocusedChannel(0)
  }

  function setDomain(d: Domain) {
    updateActive(p => ({
      ...p,
      domain: d,
      // Keep the legacy percentile clips in step, so a preset saved here still
      // renders sensibly anywhere that only knows about low/high.
      low: d.kind === "percentile" ? d.low : p.low,
      high: d.kind === "percentile" ? d.high : p.high,
    }))
  }

  function setColormap(id: ColormapId) {
    updateActive(p => ({ ...p, colormap: id, domain: domainForColormap(id, resolveDomain(p)) }))
  }

  function useRecipe(recipe: Recipe) {
    updateActive(p => applyRecipe(p, recipe, focusedChannel))
  }

  function saveRecipe(label: string, expr: string, kind: RecipeKind) {
    const trimmed = label.trim()
    if (!trimmed || !expr.trim()) return
    const panel = activePanel
    const recipe: Recipe = {
      id: newRecipeId(),
      label: trimmed,
      expr: expr.trim(),
      kind,
      ...(kind === "index" && panel.mode === "gray"
        ? { colormap: panel.colormap, domain: resolveDomain(panel) }
        : {}),
    }
    setCustomRecipes([...customRecipes, recipe])
  }

  function deleteRecipe(id: string) {
    setCustomRecipes(customRecipes.filter(r => r.id !== id))
  }

  function selectPreset(p: ChannelPreset) {
    const copy = { ...p, panels: p.panels.map(pn => ({ ...pn })) }
    setEditing(copy)
    setSelectedId(p.id)
    setActivePanelId(copy.panels[0].id)
    setCustomRows({}) // fall back to inferring row mode from the loaded expressions
  }

  function canSave(): boolean {
    return editing.label.trim().length > 0 && editing.panels.every(p => !panelErrors[p.id])
  }

  function handleSave() {
    if (!canSave()) return
    if (isBuiltin) return // built-ins are not editable in place
    const exists = customPresets.some(p => p.id === editing.id)
    const next = exists
      ? customPresets.map(p => (p.id === editing.id ? editing : p))
      : [...customPresets, editing]
    setCustomPresets(next)
    setSelectedId(editing.id)
  }

  // Open a blank custom preset in the editor. Nothing is saved until the user
  // names it and hits "Save preset".
  function handleStartNew() {
    const fresh = emptyPreset()
    setEditing(fresh)
    setSelectedId(null)
    setActivePanelId(fresh.panels[0].id)
    setCustomRows({})
  }

  // Copy a built-in (or any saved preset) into a fresh editable one, so the
  // shipped presets are a starting point rather than a dead end.
  function handleDuplicatePreset() {
    const copy: ChannelPreset = {
      id: newCustomId(),
      label: editing.label ? `${editing.label} copy` : "My preset",
      panels: editing.panels.map(p => ({ ...p, id: newPanelId() })),
    }
    setEditing(copy)
    setSelectedId(null)
    setActivePanelId(copy.panels[0].id)
  }

  function handleDelete() {
    if (!selectedId || isBuiltin) return
    setCustomPresets(customPresets.filter(p => p.id !== selectedId))
    selectPreset(BUILTIN_PRESETS[0])
  }

  // ── Pixel probe ──────────────────────────────────────────────────────────
  function handleProbe(e: React.PointerEvent<HTMLCanvasElement>, panel: ChannelPanel) {
    if (!patch) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * patch.width)
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * patch.height)
    if (x < 0 || y < 0 || x >= patch.width || y >= patch.height) return
    const i = y * patch.width + x
    try {
      setProbe({ panelId: panel.id, x, y, masked: !!patch.mask?.[i], data: probePanel(patch, panel, i) })
    } catch {
      setProbe(null) // broken expression — the error is already on the panel
    }
  }

  const channelRows =
    activePanel.mode === "gray"
      ? [{ label: "Value", i: 0 }]
      : [
          { label: "Red", i: 0 },
          { label: "Green", i: 1 },
          { label: "Blue", i: 2 },
        ]

  const activeDomain = resolveDomain(activePanel)
  const activeStats = panelStats[activePanel.id] ?? null

  return (
    <div className="channels-tab">
      <div className="channels-grid">
        <div className="channels-editor">
          <div className="channels-field">
            <label htmlFor="preset-name">Preset name</label>
            <input
              id="preset-name"
              type="text"
              value={editing.label}
              placeholder="e.g. My comparison view"
              disabled={isBuiltin}
              onChange={e => setEditing({ ...editing, label: e.target.value })}
            />
            {isBuiltin && (
              <p className="channels-hint">
                Built-in presets can't be edited in place — duplicate this one to make it yours.
              </p>
            )}
          </div>

          <div className="channels-field">
            <span className="channels-field-label">Layers in this preset</span>
            <p className="channels-hint">
              Each layer is its own composite, rendered as a separate panel in the grid on the right.
            </p>
            <ul className="channels-layer-list">
              {editing.panels.map((p, idx) => (
                <li
                  key={p.id}
                  className={p.id === activePanel.id ? "channels-layer-active" : ""}
                >
                  <button className="channels-layer-btn" onClick={() => setActivePanelId(p.id)}>
                    {p.label || `Layer ${idx + 1}`}
                    <span className="channels-layer-kind">
                      {p.mode === "gray" ? getColormap(p.colormap).label.split(" ")[0] : "RGB"}
                    </span>
                    {panelErrors[p.id] && <span className="channels-layer-error-dot" title={panelErrors[p.id]!} />}
                  </button>
                  <button
                    className="channels-preset-delete"
                    aria-label={`Duplicate ${p.label || `layer ${idx + 1}`}`}
                    title="Duplicate layer"
                    onClick={() => duplicatePanel(p.id)}
                    disabled={isBuiltin}
                  >
                    ⧉
                  </button>
                  <button
                    className="channels-preset-delete"
                    aria-label={`Remove ${p.label || `layer ${idx + 1}`}`}
                    title="Remove layer"
                    onClick={() => removePanel(p.id)}
                    disabled={isBuiltin || editing.panels.length <= 1}
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
            <button className="tab-btn" onClick={addPanel} disabled={isBuiltin}>
              + Add layer
            </button>
          </div>

          <div className="channels-field">
            <label htmlFor="layer-name">Layer name</label>
            <input
              id="layer-name"
              type="text"
              value={activePanel.label}
              placeholder="e.g. SWIR false colour"
              disabled={isBuiltin}
              onChange={e => updatePanelLabel(e.target.value)}
            />
          </div>

          {/* ── What kind of picture this layer is ─────────────────────────── */}
          <div className="channels-field">
            <span className="channels-field-label">Render as</span>
            <div className="channels-segmented" role="group" aria-label="Render mode">
              <button
                className={`channels-segmented-btn ${activePanel.mode === "rgb" ? "channels-segmented-active" : ""}`}
                aria-pressed={activePanel.mode === "rgb"}
                disabled={isBuiltin}
                onClick={() => setMode("rgb")}
              >
                Colour composite
              </button>
              <button
                className={`channels-segmented-btn ${activePanel.mode === "gray" ? "channels-segmented-active" : ""}`}
                aria-pressed={activePanel.mode === "gray"}
                disabled={isBuiltin}
                onClick={() => setMode("gray")}
              >
                Single index
              </button>
            </div>
            <p className="channels-hint">
              {activePanel.mode === "rgb" ? (
                <>
                  Three formulas, one per display channel. Usually three bands (true colour, CIR),
                  but each channel takes any expression — <code>R = nd(nIR, swIR2)</code>,{" "}
                  <code>G = nd(nIR, R)</code>, <code>B = nd(nIR, swIR1)</code> puts three
                  disturbance signals in one image.
                </>
              ) : (
                <>
                  One formula, one number per pixel, shown through a colour ramp — for indices like
                  NDVI, NDMI or NBR. Pick the ramp and the value range below.
                </>
              )}
            </p>
          </div>

          {/* ── The formulas themselves ────────────────────────────────────── */}
          <div className="channels-field">
            <span className="channels-field-label">Formula</span>
            {channelRows.map(row => {
              const expr = activePanel.expressions[row.i]
              const rowKey = `${activePanel.id}:${row.i}`
              // Explicit choice wins; otherwise infer from the value so saved
              // presets reopen with their expression editor already showing.
              const showSelectAsCustom = customRows[rowKey] ?? !isBareBand(expr)
              return (
                <div className="channels-row" key={row.i}>
                  <span className="channels-row-label">{row.label}</span>
                  <select
                    value={showSelectAsCustom ? CUSTOM_EXPR : expr}
                    disabled={isBuiltin}
                    onFocus={() => setFocusedChannel(row.i)}
                    onChange={e => {
                      const v = e.target.value
                      if (v === CUSTOM_EXPR) {
                        setCustomRows(prev => ({ ...prev, [rowKey]: true }))
                      } else {
                        setCustomRows(prev => ({ ...prev, [rowKey]: false }))
                        updateChannel(row.i, v)
                      }
                    }}
                  >
                    {BAND_OPTIONS.map(b => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                    <option value={CUSTOM_EXPR}>Custom expression…</option>
                  </select>
                  {showSelectAsCustom && (
                    <input
                      type="text"
                      className="channels-expr-input"
                      value={expr}
                      disabled={isBuiltin}
                      onFocus={() => setFocusedChannel(row.i)}
                      onChange={e => updateChannel(row.i, e.target.value)}
                      placeholder="e.g. (nIR - R) / (nIR + R)"
                    />
                  )}
                  {panelErrors[activePanel.id] && (
                    <span className="channels-error">{panelErrors[activePanel.id]}</span>
                  )}
                </div>
              )
            })}
          </div>

          <RecipeLibrary
            kind="index"
            custom={customRecipes}
            disabled={isBuiltin}
            currentExpr={activePanel.expressions[focusedChannel] ?? ""}
            label="Index library"
            hint={
              activePanel.mode === "rgb"
                ? `Drops the formula into the ${channelRows[focusedChannel]?.label.toLowerCase() ?? "red"} channel.`
                : "Loads the formula together with the colour ramp and value range that suit it."
            }
            onUse={useRecipe}
            onSave={(name, expr) => saveRecipe(name, expr, "index")}
            onDelete={deleteRecipe}
          />

          {/* ── Colour ramp + value range (index panels) ───────────────────── */}
          {activePanel.mode === "gray" ? (
            <div className="channels-field">
              <span className="channels-field-label">Colour ramp</span>
              <div className="channels-row">
                <select
                  value={activePanel.colormap ?? "grey"}
                  disabled={isBuiltin}
                  aria-label="Colour ramp"
                  onChange={e => setColormap(e.target.value as ColormapId)}
                >
                  <optgroup label="Sequential — one-directional quantity">
                    {COLORMAPS.filter(c => c.kind === "sequential").map(c => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Diverging — has a meaningful middle">
                    {COLORMAPS.filter(c => c.kind === "diverging").map(c => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <span
                  className="channels-ramp-swatch"
                  style={{ background: colormapGradient(activePanel.colormap, activePanel.reverse) }}
                />
                <label className="channels-checkbox-row">
                  <input
                    type="checkbox"
                    checked={!!activePanel.reverse}
                    disabled={isBuiltin}
                    onChange={e => updateActive(p => ({ ...p, reverse: e.target.checked || undefined }))}
                  />
                  Flip
                </label>
              </div>
              <p className="channels-hint">{getColormap(activePanel.colormap).note}</p>

              <span className="channels-field-label">Value range</span>
              <div className="channels-row">
                <select
                  value={activeDomain.kind}
                  disabled={isBuiltin}
                  aria-label="Value range mode"
                  onChange={e => {
                    const kind = e.target.value as Domain["kind"]
                    if (kind === "percentile") {
                      setDomain({ kind, low: activePanel.low ?? 2, high: activePanel.high ?? 98 })
                    } else if (kind === "symmetric") {
                      setDomain({ kind, center: 0 })
                    } else {
                      const r = activeStats?.ranges[0]
                      setDomain({ kind, min: r ? r[0] : -1, max: r ? r[1] : 1 })
                    }
                  }}
                >
                  <option value="percentile">Stretch to this tile (percentile)</option>
                  <option value="fixed">Fixed range</option>
                  <option value="symmetric">Symmetric around a centre</option>
                </select>
              </div>

              {activeDomain.kind === "percentile" && (
                <div className="channels-percentile-row">
                  <label>
                    Low %
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={activeDomain.low}
                      disabled={isBuiltin}
                      onChange={e =>
                        setDomain({ ...activeDomain, low: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    High %
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={activeDomain.high}
                      disabled={isBuiltin}
                      onChange={e =>
                        setDomain({ ...activeDomain, high: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
              )}

              {activeDomain.kind === "fixed" && (
                <div className="channels-percentile-row">
                  <label>
                    Min
                    <input
                      type="number"
                      step={0.05}
                      value={activeDomain.min}
                      disabled={isBuiltin}
                      onChange={e => setDomain({ ...activeDomain, min: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Max
                    <input
                      type="number"
                      step={0.05}
                      value={activeDomain.max}
                      disabled={isBuiltin}
                      onChange={e => setDomain({ ...activeDomain, max: Number(e.target.value) })}
                    />
                  </label>
                  <button
                    className="tab-btn"
                    disabled={isBuiltin}
                    onClick={() => setDomain({ kind: "fixed", min: -1, max: 1 })}
                  >
                    −1…1
                  </button>
                  <button
                    className="tab-btn"
                    disabled={isBuiltin || !activeStats}
                    title="Pin to what this tile currently shows"
                    onClick={() => {
                      const r = activeStats?.ranges[0]
                      if (r) setDomain({ kind: "fixed", min: Number(r[0].toFixed(3)), max: Number(r[1].toFixed(3)) })
                    }}
                  >
                    Pin current
                  </button>
                </div>
              )}

              {activeDomain.kind === "symmetric" && (
                <div className="channels-percentile-row">
                  <label>
                    Centre
                    <input
                      type="number"
                      step={0.05}
                      value={activeDomain.center}
                      disabled={isBuiltin}
                      onChange={e => setDomain({ kind: "symmetric", center: Number(e.target.value) })}
                    />
                  </label>
                </div>
              )}

              <p className="channels-hint">
                {activeDomain.kind === "percentile"
                  ? "Fills the ramp on every tile — good for exploring, but the same colour means a different value on the next tile."
                  : activeDomain.kind === "fixed"
                    ? "Colour means the same value on every tile. This is the one to use when you're judging tiles against each other."
                    : "Range grows outward from the centre by the same amount on both sides, so a diverging ramp's neutral colour lands exactly on it."}
              </p>

              <span className="channels-field-label">Classes (optional)</span>
              <div className="channels-row">
                <input
                  type="text"
                  className="channels-expr-input"
                  placeholder="e.g. 0.1, 0.27, 0.44 — leave empty for a continuous ramp"
                  defaultValue={(activePanel.bins ?? []).join(", ")}
                  key={`${activePanel.id}-bins`}
                  disabled={isBuiltin}
                  onBlur={e => {
                    const bins = parseBins(e.target.value)
                    updateActive(p => ({ ...p, bins: bins.length > 0 ? bins : undefined }))
                  }}
                />
                {activePanel.bins && activePanel.bins.length > 0 && (
                  <button
                    className="tab-btn"
                    disabled={isBuiltin}
                    onClick={() => updateActive(p => ({ ...p, bins: undefined }))}
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="channels-hint">
                Value breaks, lowest first. Turns the ramp into flat severity classes — "is this
                pixel in class 3" is a far easier call than "is this grey darker than that grey".
              </p>
            </div>
          ) : (
            /* ── Composite display controls ──────────────────────────────── */
            <div className="channels-field">
              <span className="channels-field-label">Contrast</span>
              <div className="channels-row">
                <select
                  value={activePanel.stretch}
                  disabled={isBuiltin}
                  aria-label="Stretch mode"
                  onChange={e =>
                    updateActive(p => ({ ...p, stretch: e.target.value as ChannelPanel["stretch"] }))
                  }
                >
                  <option value="shared">One range for all three (keeps colour balance)</option>
                  <option value="per-channel">A range per channel (maximum contrast)</option>
                </select>
              </div>
              <div className="channels-percentile-row">
                <label>
                  Low %
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={activePanel.low ?? 2}
                    disabled={isBuiltin}
                    onChange={e => {
                      const low = Number(e.target.value)
                      updateActive(p => ({
                        ...p,
                        low,
                        domain:
                          resolveDomain(p).kind === "percentile"
                            ? { kind: "percentile", low, high: p.high ?? 98 }
                            : p.domain,
                      }))
                    }}
                  />
                </label>
                <label>
                  High %
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={activePanel.high ?? 98}
                    disabled={isBuiltin}
                    onChange={e => {
                      const high = Number(e.target.value)
                      updateActive(p => ({
                        ...p,
                        high,
                        domain:
                          resolveDomain(p).kind === "percentile"
                            ? { kind: "percentile", low: p.low ?? 2, high }
                            : p.domain,
                      }))
                    }}
                  />
                </label>
              </div>
              <label className="channels-slider-row">
                <span>Gamma {(activePanel.gamma ?? 1).toFixed(1)}</span>
                <input
                  type="range"
                  min={40}
                  max={250}
                  value={Math.round((activePanel.gamma ?? 1) * 100)}
                  disabled={isBuiltin}
                  onChange={e => {
                    const g = Number(e.target.value) / 100
                    updateActive(p => ({ ...p, gamma: g === 1 ? undefined : g }))
                  }}
                />
              </label>
              <p className="channels-hint">
                Gamma above 1 lifts the dark end without blowing out the highlights — closed
                canopy in true colour is otherwise a wall of near-black.
              </p>
            </div>
          )}

          {/* ── Threshold overlay ──────────────────────────────────────────── */}
          <div className="channels-field">
            <span className="channels-field-label">Threshold overlay</span>
            <p className="channels-hint">
              A 0/1 rule painted on top of this layer. Write the rule you'd use to call windthrow,
              then look at where it disagrees with the model's mask — that disagreement is the
              whole job of this page.
            </p>
            <div className="channels-row">
              <input
                type="text"
                className="channels-expr-input"
                value={activePanel.overlay?.expr ?? ""}
                disabled={isBuiltin}
                placeholder="e.g. nd(nIR, swIR2) < 0.2 and nd(nIR, R) < 0.5"
                onChange={e =>
                  updateActive(p => ({
                    ...p,
                    overlay: {
                      expr: e.target.value,
                      color: p.overlay?.color ?? DEFAULT_OVERLAY_COLOR,
                      alpha: p.overlay?.alpha ?? DEFAULT_OVERLAY_ALPHA,
                    },
                  }))
                }
              />
              <input
                type="color"
                aria-label="Overlay colour"
                className="channels-color-input"
                value={activePanel.overlay?.color ?? DEFAULT_OVERLAY_COLOR}
                disabled={isBuiltin}
                onChange={e =>
                  updateActive(p => ({
                    ...p,
                    overlay: {
                      expr: p.overlay?.expr ?? "",
                      color: e.target.value,
                      alpha: p.overlay?.alpha ?? DEFAULT_OVERLAY_ALPHA,
                    },
                  }))
                }
              />
              {activePanel.overlay && (
                <button
                  className="tab-btn"
                  disabled={isBuiltin}
                  onClick={() => updateActive(p => ({ ...p, overlay: undefined }))}
                >
                  Clear
                </button>
              )}
            </div>
            {activePanel.overlay?.expr.trim() && (
              <>
                <label className="channels-slider-row">
                  <span>Opacity {Math.round((activePanel.overlay.alpha ?? DEFAULT_OVERLAY_ALPHA) * 100)}%</span>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={Math.round((activePanel.overlay.alpha ?? DEFAULT_OVERLAY_ALPHA) * 100)}
                    disabled={isBuiltin}
                    onChange={e =>
                      updateActive(p => ({
                        ...p,
                        overlay: {
                          expr: p.overlay?.expr ?? "",
                          color: p.overlay?.color ?? DEFAULT_OVERLAY_COLOR,
                          alpha: Number(e.target.value) / 100,
                        },
                      }))
                    }
                  />
                </label>
                {activeStats?.overlayPixels != null && patch && (
                  <p className="channels-hint">
                    Rule covers {((activeStats.overlayPixels / (patch.width * patch.height)) * 100).toFixed(1)}%
                    of the tile.
                  </p>
                )}
              </>
            )}
          </div>

          <RecipeLibrary
            kind="mask"
            custom={customRecipes}
            disabled={isBuiltin}
            currentExpr={activePanel.overlay?.expr ?? ""}
            label="Rule library"
            hint="Thresholds are starting points, not settled numbers — move them until the overlay hugs what you can actually see."
            onUse={useRecipe}
            onSave={(name, expr) => saveRecipe(name, expr, "mask")}
            onDelete={deleteRecipe}
          />

          {/* ── Reference ──────────────────────────────────────────────────── */}
          <div className="channels-field">
            <span className="channels-field-label">Band reference</span>
            <div className="channels-band-table-wrap">
              <table className="channels-band-table">
                <thead>
                  <tr>
                    <th>Band</th>
                    <th>Meaning</th>
                    <th>Landsat 8</th>
                    <th>Typical range</th>
                  </tr>
                </thead>
                <tbody>
                  {BAND_REFERENCE.map(b => (
                    <tr key={b.id}>
                      <td>{b.id}</td>
                      <td>{b.meaning}</td>
                      <td>{b.landsat}</td>
                      <td>{b.range}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="channels-nbr-note">
              <strong>NBR</strong> is stored rescaled to 0…1 as (NBR + 1) / 2. For raw NBR in
              −1…1 write <code>NBR * 2 - 1</code> or <code>nd(nIR, swIR2)</code>.
            </p>
          </div>

          <div className="channels-field">
            <span className="channels-field-label">Expression reference</span>
            <p className="channels-hint">
              Arithmetic <code>+ - * /</code>, powers <code>^</code>, comparisons{" "}
              <code>&lt; &lt;= &gt; &gt;= == !=</code> (giving 1 or 0), and{" "}
              <code>and</code> / <code>or</code> / <code>!</code>. Anything undefined — dividing by
              zero, the square root of a negative, a fill pixel — comes out as no-data and is drawn
              transparent instead of being counted as zero.
            </p>
            <div className="channels-band-table-wrap">
              <table className="channels-band-table">
                <tbody>
                  {FUNC_HELP.map(f => (
                    <tr key={f.name}>
                      <td>
                        <code>{f.sig}</code>
                      </td>
                      <td>{f.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="channels-actions">
            <button className="tab-btn tab-btn-active" onClick={handleSave} disabled={!canSave() || isBuiltin}>
              Save preset
            </button>
            <button className="tab-btn" onClick={handleDuplicatePreset}>
              Duplicate as new
            </button>
            <button className="tab-btn" onClick={handleStartNew}>
              Start new preset
            </button>
            <button className="tab-btn" onClick={handleDelete} disabled={isBuiltin || !selectedId}>
              Delete
            </button>
          </div>

          <div className="channels-field">
            <span className="channels-field-label">Saved presets</span>
            {presetsSyncError && (
              <p className="channels-error">
                Couldn't sync presets to your account ({presetsSyncError}) — changes are saved on
                this device only until it reconnects.
              </p>
            )}
            <ul className="channels-preset-list">
              {allPresetsList(customPresets).map(p => (
                <li key={p.id} className={p.id === selectedId ? "channels-preset-active" : ""}>
                  <button className="channels-preset-btn" onClick={() => selectPreset(p)}>
                    {p.label}
                    <span className="channels-preset-count">
                      {p.panels.length} layer{p.panels.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  {!p.builtin && (
                    <button
                      className="channels-preset-delete"
                      aria-label={`Delete ${p.label}`}
                      onClick={() => {
                        setCustomPresets(customPresets.filter(cp => cp.id !== p.id))
                        if (selectedId === p.id) selectPreset(BUILTIN_PRESETS[0])
                      }}
                    >
                      &times;
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="channels-preview">
          {!patch ? (
            <div className="channels-preview-canvas-wrap channels-empty-state">
              <p>No tile loaded yet.</p>
              <button className="tab-btn tab-btn-active" onClick={loadSampleTile} disabled={loadingTile}>
                {loadingTile ? "Loading…" : "Load a sample tile"}
              </button>
              {tileError && <p className="channels-error">{tileError}</p>}
            </div>
          ) : (
            <>
              <div
                className="channels-panel-grid"
                style={{ "--panel-count": editing.panels.length } as React.CSSProperties}
              >
                {editing.panels.map(p => (
                  <div className="channels-panel" key={p.id}>
                    <canvas
                      ref={el => {
                        if (el) canvasRefs.current.set(p.id, el)
                        else canvasRefs.current.delete(p.id)
                      }}
                      className="channels-canvas"
                      onPointerMove={e => handleProbe(e, p)}
                      onPointerLeave={() => setProbe(null)}
                      onClick={() => setActivePanelId(p.id)}
                    />
                    <span className="channels-panel-label">{p.label || "Untitled layer"}</span>
                    <Colorbar panel={p} stats={panelStats[p.id] ?? null} compact />
                    {panelErrors[p.id] && <span className="channels-panel-error">{panelErrors[p.id]}</span>}
                  </div>
                ))}
              </div>

              <ProbeReadout probe={probe} />

              <div className="channels-preview-controls">
                <label className="channels-checkbox-row">
                  <input type="checkbox" checked={showMask} onChange={e => setShowMask(e.target.checked)} />
                  Show the proposed mask
                </label>
                <button className="tab-btn" onClick={loadSampleTile} disabled={loadingTile}>
                  {loadingTile ? <span className="spinner" /> : "Load another tile"}
                </button>
                {tileError && <p className="channels-error">{tileError}</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Recipe library ──────────────────────────────────────────────────────────

interface RecipeLibraryProps {
  kind: RecipeKind
  custom: Recipe[]
  disabled: boolean
  /** Expression currently in the editor, offered for saving under a name. */
  currentExpr: string
  label: string
  hint: string
  onUse: (r: Recipe) => void
  onSave: (name: string, expr: string) => void
  onDelete: (id: string) => void
}

/** The shipped formulas plus the reviewer's own, side by side — a saved
 * formula is worth as much as a built-in one, and a long tasselled-cap
 * expression is unusable if it has to be retyped every session. */
function RecipeLibrary({
  kind,
  custom,
  disabled,
  currentExpr,
  label,
  hint,
  onUse,
  onSave,
  onDelete,
}: RecipeLibraryProps) {
  const [name, setName] = useState("")
  const recipes = recipesOfKind(custom, kind)

  function save() {
    onSave(name, currentExpr)
    setName("")
  }

  return (
    <div className="channels-field">
      <span className="channels-field-label">{label}</span>
      <p className="channels-hint">{hint}</p>
      <div className="channels-recipe-row">
        {recipes.map(r => (
          <span className="channels-recipe-chip" key={r.id}>
            <button
              className="tab-btn"
              onClick={() => onUse(r)}
              disabled={disabled}
              title={r.note ? `${r.expr}\n\n${r.note}` : r.expr}
            >
              {r.label}
            </button>
            {!r.builtin && (
              <button
                className="channels-preset-delete"
                aria-label={`Delete ${r.label}`}
                title="Delete this saved formula"
                onClick={() => onDelete(r.id)}
              >
                &times;
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="channels-row">
        <input
          type="text"
          className="channels-expr-input"
          placeholder={`Save the current formula as… (${kind === "index" ? "index" : "rule"})`}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && name.trim() && currentExpr.trim()) save()
          }}
        />
        <button className="tab-btn" onClick={save} disabled={!name.trim() || !currentExpr.trim()}>
          Save
        </button>
      </div>
    </div>
  )
}

// ── Pixel probe ─────────────────────────────────────────────────────────────

/** Every number behind the pixel under the cursor. Without this a colour ramp
 * asks to be trusted on faith; with it a reviewer can calibrate their eye
 * against actual values in a few seconds. */
function ProbeReadout({ probe }: { probe: Probe | null }) {
  if (!probe) {
    return (
      <p className="channels-probe channels-probe-idle">
        Hover a panel to read the values under the cursor.
      </p>
    )
  }
  const { data } = probe
  return (
    <div className="channels-probe">
      <div className="channels-probe-head">
        <strong>
          x {probe.x}, y {probe.y}
        </strong>
        <span className={probe.masked ? "channels-probe-in-mask" : "channels-probe-out-mask"}>
          {probe.masked ? "inside proposed mask" : "outside proposed mask"}
        </span>
      </div>
      <div className="channels-probe-bands">
        {BAND_OPTIONS.map((b, i) => (
          <span key={b}>
            <em>{b}</em> {formatValue(data.bands[i])}
          </span>
        ))}
      </div>
      <div className="channels-probe-bands">
        {data.channels.map((c, i) => (
          <span key={i}>
            <em>{c.label}</em> {formatValue(c.value)}
          </span>
        ))}
        {data.overlay && (
          <span>
            <em>Rule</em> {data.overlay.hit ? "✔ fires here" : "— no"}
          </span>
        )}
      </div>
    </div>
  )
}

function allPresetsList(custom: ChannelPreset[]): ChannelPreset[] {
  return BUILTIN_PRESETS.concat(custom)
}
