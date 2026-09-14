import { IMAGERY } from "../constants"
import type { TileMeta } from "./review"

export interface LatLon {
  lat: number
  lon: number
}

// Centre of the tile's bbox, or null when the index carries no bbox.
export function bboxCenter(m: TileMeta | undefined): LatLon | null {
  if (!m || m.lonMin === undefined || m.latMin === undefined || m.lonMax === undefined || m.latMax === undefined) {
    return null
  }
  return { lat: (m.latMin + m.latMax) / 2, lon: (m.lonMin + m.lonMax) / 2 }
}

// "2.034° S · 61.874° W" — 3 decimals ≈ 110 m, enough to find the tile again.
export function formatLatLon(p: LatLon, decimals = 3): string {
  const ns = p.lat >= 0 ? "N" : "S"
  const ew = p.lon >= 0 ? "E" : "W"
  return `${Math.abs(p.lat).toFixed(decimals)}° ${ns} · ${Math.abs(p.lon).toFixed(decimals)}° ${ew}`
}

// Outbound link to Google Maps satellite view, centred on the tile.
export function mapsUrl(p: LatLon): string {
  return `https://www.google.com/maps/@?api=1&map_action=map&center=${p.lat},${p.lon}&zoom=13&basemap=satellite`
}

export interface Acquisition {
  text: string   // what to show
  exact: boolean // true = real per-tile dates; false = the scan's search window
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// Parse "YYYY-MM-DD" defensively — no Date parsing, no locale surprises.
function parseDate(s: string): { y: string; m: string; d: string } | null {
  const parts = s.split("-")
  if (parts.length !== 3) return null
  const [y, mo, d] = parts
  const mi = Number(mo) - 1
  if (!y || mi < 0 || mi > 11 || !d) return null
  return { y, m: MONTHS[mi], d: String(Number(d)) }
}

function formatOne(s: string): string {
  const p = parseDate(s)
  return p ? `${p.d} ${p.m} ${p.y}` : s
}

// What to show for a tile's acquisition date, and whether it is a real
// per-tile date or just the scan's search window ("je nachdem was da ist").
export function formatAcquisition(m: TileMeta | undefined): Acquisition {
  const first = m?.dateFirst
  const last = m?.dateLast

  if (first && last) {
    if (first === last) return { text: formatOne(first), exact: true }
    const pf = parseDate(first)
    const pl = parseDate(last)
    if (pf && pl) {
      const from = pf.y === pl.y ? `${pf.d} ${pf.m}` : `${pf.d} ${pf.m} ${pf.y}`
      return { text: `${from} – ${pl.d} ${pl.m} ${pl.y}`, exact: true }
    }
    return { text: `${first} – ${last}`, exact: true }
  }
  if (first) return { text: formatOne(first), exact: true }
  if (last) return { text: formatOne(last), exact: true }
  return { text: IMAGERY.fallbackLabel, exact: false }
}
