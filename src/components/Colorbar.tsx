import { binLegend, formatValue, resolveDomain } from "../utils/channels"
import type { ChannelPanel, PanelStats } from "../utils/channels"
import { colormapGradient } from "../utils/colormaps"

const RGB_LABELS = ["R", "G", "B"]

interface ColorbarProps {
  panel: ChannelPanel
  /** What the last render actually put on screen; null before the first one. */
  stats: PanelStats | null
  /** Drop the explanatory footnote — for the tight grid on the Channels page. */
  compact?: boolean
}

/**
 * The numbers behind the picture. A colour ramp without a labelled scale is
 * decoration: it tells a reviewer that one pixel is redder than another, but
 * not whether that difference is worth anything. This says what value each
 * colour stands for — and, when the range is a per-tile percentile stretch,
 * warns that it will mean something else on the next tile.
 */
export function Colorbar({ panel, stats, compact }: ColorbarProps) {
  if (!stats) return null

  const domain = resolveDomain(panel)
  const floating = domain.kind === "percentile"

  if (panel.mode === "rgb") {
    return (
      <div className="colorbar">
        <div className="colorbar-rgb">
          {stats.ranges.map((r, i) => (
            <span key={i} className="colorbar-rgb-item">
              <span className={`colorbar-dot colorbar-dot-${RGB_LABELS[i].toLowerCase()}`} />
              {RGB_LABELS[i]} {formatValue(r[0])} – {formatValue(r[1])}
            </span>
          ))}
        </div>
        {!compact && floating && (
          <p className="colorbar-note">
            Stretched to this tile's {domain.low}–{domain.high}th percentile, so the same
            brightness means a different reflectance on the next tile.
          </p>
        )}
        {!compact && domain.kind === "fixed" && (
          <p className="colorbar-note">
            Fixed range — the same reflectance looks the same on every tile.
          </p>
        )}
        <NoDataNote stats={stats} />
      </div>
    )
  }

  const bins = binLegend(panel)
  if (bins.length > 0) {
    return (
      <div className="colorbar">
        <ul className="colorbar-classes">
          {bins.map(b => (
            <li key={b.label}>
              <span className="colorbar-swatch" style={{ background: b.color }} />
              {b.label}
            </li>
          ))}
        </ul>
        <NoDataNote stats={stats} />
      </div>
    )
  }

  const [lo, hi] = stats.ranges[0]
  const mid = (lo + hi) / 2
  return (
    <div className="colorbar">
      <div
        className="colorbar-ramp"
        style={{ background: colormapGradient(panel.colormap, panel.reverse) }}
      />
      <div className="colorbar-ticks">
        <span>{formatValue(lo)}</span>
        <span>{formatValue(mid)}</span>
        <span>{formatValue(hi)}</span>
      </div>
      {!compact && (
        <p className="colorbar-note">
          {floating ? (
            <>
              Range is this tile's {domain.low}–{domain.high}th percentile — it moves from tile to
              tile. Pin it to a fixed range to compare tiles against each other.
            </>
          ) : domain.kind === "symmetric" ? (
            <>Centred on {formatValue(domain.center)}, so the ramp's neutral colour sits exactly there.</>
          ) : (
            <>Fixed range — this colour means the same value on every tile.</>
          )}
        </p>
      )}
      <NoDataNote stats={stats} />
    </div>
  )
}

function NoDataNote({ stats }: { stats: PanelStats }) {
  if (stats.nodata === 0) return null
  return (
    <p className="colorbar-nodata">
      {stats.nodata.toLocaleString("en-US")} px no-data (drawn transparent)
    </p>
  )
}
