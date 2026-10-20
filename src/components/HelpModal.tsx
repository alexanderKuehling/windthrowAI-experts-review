import { useCallback, useEffect, useRef } from "react"
import { BUILTIN_PRESETS, renderPreset } from "../utils/channels"
import { makeDemoPatch } from "../utils/demoPatch"
import type { DemoPatch } from "../utils/demoPatch"
import { REDO_KEYS, UNDO_KEYS, ZOOM_MOD } from "../utils/keys"

export type HelpSection =
  | "overview"
  | "bands"
  | "opacity"
  | "add"
  | "remove"
  | "brush"
  | "zoom"
  | "undo"
  | "decision"
  | "spotcheck"
  | "filter"
  | "custom"

interface HelpModalProps {
  section?: HelpSection // scroll target on open
  onClose: () => void
  onOpenChannels: () => void
}

// Render the demo patch + a mask overlay (same compositing as the review
// canvas) onto a plain 2D canvas context.
function drawTile(
  ctx: CanvasRenderingContext2D,
  patch: DemoPatch,
  mask: Uint8Array,
  alpha: number,
  preset = BUILTIN_PRESETS[0],
) {
  const { width, height } = patch
  const bg = new Uint8ClampedArray(width * height * 4)
  renderPreset(patch, preset, bg)
  const img = ctx.createImageData(width, height)
  const d = img.data
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    if (mask[i]) {
      d[o] = bg[o] * (1 - alpha) + 255 * alpha
      d[o + 1] = bg[o + 1] * (1 - alpha)
      d[o + 2] = bg[o + 2] * (1 - alpha)
    } else {
      d[o] = bg[o]
      d[o + 1] = bg[o + 1]
      d[o + 2] = bg[o + 2]
    }
    d[o + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

function brushCircle(mask: Uint8Array, width: number, height: number, cx: number, cy: number, r: number, val: number) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      mask[y * width + x] = val
    }
  }
}

function PreviewCanvas({ draw, size = 140 }: { draw: (ctx: CanvasRenderingContext2D) => void; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")!
    draw(ctx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <canvas ref={ref} width={96} height={96} className="help-canvas" style={{ width: size, height: size }} />
}

function BeforeAfter({
  before,
  after,
  captionBefore,
  captionAfter,
}: {
  before: (ctx: CanvasRenderingContext2D) => void
  after: (ctx: CanvasRenderingContext2D) => void
  captionBefore: string
  captionAfter: string
}) {
  return (
    <div className="help-pair">
      <div className="help-pair-item">
        <PreviewCanvas draw={before} />
        <p className="help-caption">{captionBefore}</p>
      </div>
      <span className="help-arrow" aria-hidden="true">
        →
      </span>
      <div className="help-pair-item">
        <PreviewCanvas draw={after} />
        <p className="help-caption">{captionAfter}</p>
      </div>
    </div>
  )
}

export function HelpModal({ section, onClose, onOpenChannels }: HelpModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const sectionRefs = useRef<Partial<Record<HelpSection, HTMLElement | null>>>({})

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    closeBtnRef.current?.focus()
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [onClose])

  useEffect(() => {
    if (!section) return
    sectionRefs.current[section]?.scrollIntoView({ block: "start" })
  }, [section])

  const demo = makeDemoPatch()

  // A single stable ref callback (never a per-section closure) that reads the
  // target section off the element's own data attribute.
  const registerSection = useCallback((el: HTMLElement | null) => {
    if (!el) return
    const id = el.dataset.section as HelpSection | undefined
    if (id) sectionRefs.current[id] = el
  }, [])

  return (
    <div className="legal-overlay" onClick={onClose}>
      <div
        className="legal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="How this page works"
        onClick={e => e.stopPropagation()}
      >
        <header className="legal-panel-head">
          <h2>How this page works</h2>
          <button className="legal-close" ref={closeBtnRef} onClick={onClose} aria-label="Close">
            &times;
          </button>
        </header>
        <div className="legal-body help-body">
          <section ref={registerSection} data-section="overview">
            <h3>What you are looking at</h3>
            <PreviewCanvas
              size={200}
              draw={ctx => drawTile(ctx, demo, demo.mask, 0.45)}
            />
            <p className="help-caption">
              Red = the model's proposed windthrow area. You confirm it, correct it, or say it's
              wrong.
            </p>
          </section>

          <section ref={registerSection} data-section="bands">
            <h3>Band combination</h3>
            <div className="help-thumb-row">
              {BUILTIN_PRESETS.map(p => (
                <div className="help-pair-item" key={p.id}>
                  <PreviewCanvas
                    size={80}
                    draw={ctx => drawTile(ctx, demo, new Uint8Array(demo.width * demo.height), 0, p)}
                  />
                  <p className="help-caption">{p.label}</p>
                </div>
              ))}
            </div>
            <p>
              Each combination shows the same tile through different Landsat bands. Switching only
              changes how the imagery is drawn; the red mask and your edits stay as they are, so
              flip between them freely before you decide.
            </p>
            <ul>
              <li>
                <strong>True colour</strong>: roughly what the eye would see, on the same
                brightness scale on every tile. Fallen trees show as lighter, brownish patches in
                the green canopy.
              </li>
              <li>
                <strong>Colour infrared</strong>: healthy canopy glows red. Opened canopy, bare
                soil and debris turn cyan to grey, which makes the edge of a scar easier to trace.
              </li>
              <li>
                <strong>SWIR</strong>: intact forest is green; bare wood, soil and dry debris
                stand out in pink to magenta.
              </li>
              <li>
                <strong>NBR</strong>: a single index on a red → green ramp. Green is intact
                canopy, yellow to red is disturbance.
              </li>
              <li>
                <strong>Canopy moisture (NDMI)</strong>: water in the leaves on a brown → teal
                ramp. Brown means dry, often a sign of damaged canopy.
              </li>
              <li>
                <strong>Greenness (SAVI)</strong>: like the familiar NDVI, but it still tells
                thinned canopy from intact canopy where NDVI looks the same. Green is dense canopy.
              </li>
              <li>
                <strong>Dry wood (NBR2)</strong>: picks up dry woody material such as fallen
                trunks, on a brown → teal ramp. Brown means dry.
              </li>
              <li>
                <strong>Bare ground (TC brightness)</strong>: overall brightness. Bare soil and
                debris show up yellow; closed canopy stays dark. Scaled per tile, so compare
                areas within a tile rather than across tiles.
              </li>
              <li>
                <strong>Compare all</strong>: every combination above side by side.
              </li>
            </ul>
            <p>
              These are only starting points. There is a whole tab just for channel settings,{" "}
              <strong>Channels</strong> in the header (or <strong>🎨 Customize…</strong> next to
              these buttons), where you can build your own views. See{" "}
              <em>Custom band combinations</em> at the end of this guide.
            </p>
          </section>

          <section ref={registerSection} data-section="opacity">
            <h3>Mask opacity</h3>
            <BeforeAfter
              before={ctx => drawTile(ctx, demo, demo.mask, 0.25)}
              after={ctx => drawTile(ctx, demo, demo.mask, 0.8)}
              captionBefore="25% — see the imagery through the mask"
              captionAfter="80% — see the mask's exact edges"
            />
          </section>

          <section ref={registerSection} data-section="add">
            <h3>Add pixels</h3>
            <p>
              Use this when the <strong>red</strong> windthrow mask stops short of damage you can
              see in the imagery — a patch of downed trees the model missed at the edge of the
              scar, or a separate blowdown area it didn't pick up at all. Select "Add pixels",
              then paint over the imagery: every stroke turns that area red.
            </p>
            <p>
              <strong>Striped</strong> areas are not part of the mask — they're no-data (cloud,
              cloud shadow or a gap between satellite scenes) baked into the tile itself, with no
              imagery to judge. Only the red overlay reflects what gets submitted.
            </p>
            <BeforeAfter
              before={ctx => drawTile(ctx, demo, demo.mask, 0.45)}
              after={ctx => {
                const filled = Uint8Array.from(demo.mask)
                const { width, height } = demo
                // Fill the missing quarter of the scar (u > 0.3*a region).
                const cx = width * 0.55
                const cy = height * 0.45
                const angle = 0.6
                const a = width * 0.32
                const b = height * 0.11
                const cos = Math.cos(angle)
                const sin = Math.sin(angle)
                for (let y = 0; y < height; y++) {
                  for (let x = 0; x < width; x++) {
                    const dx = x - cx
                    const dy = y - cy
                    const u = dx * cos + dy * sin
                    const v = -dx * sin + dy * cos
                    const d = (u * u) / (a * a) + (v * v) / (b * b)
                    if (d < 1) filled[y * width + x] = 1
                  }
                }
                drawTile(ctx, demo, filled, 0.45)
              }}
              captionBefore="the model missed part of the scar"
              captionAfter="painted in with the brush"
            />
          </section>

          <section ref={registerSection} data-section="remove">
            <h3>Remove pixels</h3>
            <p>
              Use this when the model marked something red that <strong>isn't</strong> windthrow —
              a shadow, a bare field, a road, or a blob that just doesn't match downed trees in
              the imagery. Select "Remove pixels" and paint over the red area to erase it from the
              mask; the imagery underneath is untouched, only the red overlay shrinks.
            </p>
            <p>
              You don't need to remove every stray pixel by hand — if the whole tile turns out to
              have no real windthrow, use <strong>"No windthrow here"</strong> below instead of
              erasing it all manually.
            </p>
            <BeforeAfter
              before={ctx => drawTile(ctx, demo, demo.mask, 0.45)}
              after={ctx => {
                const cleaned = Uint8Array.from(demo.mask)
                const { width, height } = demo
                const blobCx = width * 0.15
                const blobCy = height * 0.8
                const blobR = width * 0.06 + 2
                for (let y = 0; y < height; y++) {
                  for (let x = 0; x < width; x++) {
                    const dx = x - blobCx
                    const dy = y - blobCy
                    if (dx * dx + dy * dy < blobR * blobR) cleaned[y * width + x] = 0
                  }
                }
                drawTile(ctx, demo, cleaned, 0.45)
              }}
              captionBefore="a false blob outside the real scar"
              captionAfter="painted away"
            />
          </section>

          <section ref={registerSection} data-section="brush">
            <h3>Brush</h3>
            <BeforeAfter
              before={ctx => {
                const m = Uint8Array.from(demo.mask)
                brushCircle(m, demo.width, demo.height, 20, 70, 2, 1)
                drawTile(ctx, demo, m, 0.45)
              }}
              after={ctx => {
                const m = Uint8Array.from(demo.mask)
                brushCircle(m, demo.width, demo.height, 20, 70, 10, 1)
                drawTile(ctx, demo, m, 0.45)
              }}
              captionBefore="small brush — precise edges"
              captionAfter="large brush — quick coverage"
            />
          </section>

          <section ref={registerSection} data-section="zoom">
            <h3>Zoom</h3>
            <p>
              Pinch on the trackpad, or hold {ZOOM_MOD} and scroll, to zoom in where the pointer
              is; the − and + buttons under the tile (or the − and + keys) zoom in steps. Once
              zoomed in, scroll or hold Space and drag to move around, and "Whole tile" (or 0)
              zooms back out. Every layer zooms together, and painting works the same at any zoom,
              so zoom in with a 1 px brush for exact edges. The size slider next to the zoom
              buttons sets how big each plot is drawn; it's remembered separately for one layer
              and for several side by side.
            </p>
          </section>

          <section ref={registerSection} data-section="undo">
            <h3>Undo</h3>
            <p>
              <strong>↶ Undo</strong> ({UNDO_KEYS}) takes back your last stroke, and{" "}
              <strong>↷ Redo</strong> ({REDO_KEYS}) puts it back. <strong>↩️ Undo all edits</strong>{" "}
              returns to the model's proposal in one go, and can itself be undone.
            </p>
            <BeforeAfter
              before={ctx => {
                const edited = Uint8Array.from(demo.mask)
                brushCircle(edited, demo.width, demo.height, 70, 20, 8, 1)
                drawTile(ctx, demo, edited, 0.45)
              }}
              after={ctx => drawTile(ctx, demo, demo.mask, 0.45)}
              captionBefore="edited mask"
              captionAfter="restored to the model's proposal"
            />
          </section>

          <section ref={registerSection} data-section="decision">
            <h3>Your decision</h3>
            <p>
              Once the red mask on screen matches what you actually see in the imagery — using
              "Add pixels" / "Remove pixels" if needed — pick exactly one of the three buttons.
              Each one submits your review and immediately loads the next tile.
            </p>
            <ul className="help-decision-legend">
              <li>
                <span className="help-swatch help-swatch-accept" /> <strong>Confirm mask</strong>{" "}
                (or <strong>Save my corrections</strong> if you edited it) — yes, this is
                windthrow, and the red area is now an accurate outline of it. Use this whether the
                model's original mask was already correct or you had to add/remove pixels first.
              </li>
              <li>
                <span className="help-swatch help-swatch-reject" /> <strong>No windthrow here</strong> —
                the model was wrong about this tile: what it marked is something else entirely
                (shadow, bare ground, harvested field, etc.), not storm damage. Click this directly
                — you don't need to erase the mask by hand first, the whole tile is recorded as a
                false positive as-is.
              </li>
              <li>
                <span className="help-swatch help-swatch-skip" /> <strong>Skip</strong> — you can't
                tell from this imagery (too blurry, ambiguous, or you're just not confident). Skip
                submits nothing at all — the tile isn't recorded as reviewed and may come back up
                later — it just moves you to another random tile.
              </li>
            </ul>
            <p>
              On a <strong>spot check</strong> tile (blue note above the buttons) there is no red
              mask, and the buttons change. See the next section.
            </p>
          </section>

          <section ref={registerSection} data-section="spotcheck">
            <h3>Spot checks: tiles the model rejected</h3>
            <BeforeAfter
              before={ctx => drawTile(ctx, demo, new Uint8Array(demo.width * demo.height), 0.45)}
              after={ctx => drawTile(ctx, demo, demo.mask, 0.45)}
              captionBefore="spot check: the model saw nothing"
              captionAfter="you found windthrow and painted it"
            />
            <p>
              Almost every tile here was picked by the model because it thinks it shows windthrow.
              So on its own, reviewing can never reveal windthrow the model <em>missed</em>, or a
              model that starts flagging plain forest. That's why about 1 in 10 tiles is a random
              tile the model rejected. It carries a blue <strong>Spot check</strong> note and
              starts without a red mask.
            </p>
            <ul className="help-decision-legend">
              <li>
                <span className="help-swatch help-swatch-accept" />{" "}
                <strong>No windthrow: model is right</strong>: you see nothing. This is the usual
                answer, and it is just as valuable as finding something.
              </li>
              <li>
                <span className="help-swatch help-swatch-accept" />{" "}
                <strong>Save: the model missed this</strong>: you painted windthrow with "Add
                pixels". The button switches to this as soon as anything is red.
              </li>
              <li>
                <span className="help-swatch help-swatch-skip" /> <strong>Skip</strong>: you can't
                tell, same as on any other tile.
              </li>
            </ul>
            <p>
              Please judge a spot check as carefully as any other tile: the point is to find what
              the model overlooks, not to confirm it. The coverage filter below never hides spot
              checks.
            </p>
          </section>

          <section ref={registerSection} data-section="filter">
            <h3>Show tiles with at least X px windthrow</h3>
            <p>
              This is a session setting, not a per-tile action: it controls which tiles are drawn
              at random. It starts at 30 px (2.7 ha), the smallest patch the scan publishes, so
              at first it hides almost nothing. Raising it hides tiles where the model found only
              a tiny sliver of windthrow. If the tile on screen changes by itself, this is why.
            </p>
          </section>

          <section ref={registerSection} data-section="custom">
            <h3>Custom band combinations: the Channels tab</h3>
            <p>
              The band combination buttons are fixed. To look at a tile your own way, open the{" "}
              <strong>Channels</strong> tab in the header, next to Review. It's a separate page
              just for channel settings, and it opens on the tile you're reviewing, so you tune
              the view on exactly the imagery in front of you. There you can:
            </p>
            <ul>
              <li>
                <strong>Mix a colour composite</strong>: choose which band, or which formula,
                drives red, green and blue.
              </li>
              <li>
                <strong>Show a single index</strong> such as NDVI, NDMI or NBR on a colour ramp,
                with your own value range and optional class breaks.
              </li>
              <li>
                <strong>Write formulas</strong> like <code>(nIR - R) / (nIR + R)</code>, or pick
                one from the index library. Formulas you save by name are kept for later.
              </li>
              <li>
                <strong>Adjust contrast</strong>: one range for all three channels to keep the
                colour balance, or one per channel for maximum contrast.
              </li>
              <li>
                <strong>Add a threshold overlay</strong>: a rule painted on top of the image, to
                see where your own idea of windthrow disagrees with the model's mask.
              </li>
              <li>
                <strong>Stack several layers</strong> in one preset; on the Review tab they show
                side by side, like Compare all.
              </li>
            </ul>
            <p>
              Built-in combinations can't be edited directly. Use <strong>Duplicate as new</strong>{" "}
              to start from one, or <strong>Start new preset</strong> for a blank one. After{" "}
              <strong>Save preset</strong>, it appears in the <strong>Custom ▾</strong> menu next to
              the band combination buttons here. When you're signed in, your presets and saved
              formulas follow your account to other devices; in guest mode they stay in this
              browser only.
            </p>
            <button
              className="tab-btn tab-btn-active"
              onClick={() => {
                onOpenChannels()
                onClose()
              }}
            >
              Open the Channels page
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
