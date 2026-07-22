import { RANKINGS_API_URL } from "../constants"

// One reviewer's aggregated stats (the backend counts persisted reviews and
// sums the changed-pixel counts submitted with each review).
export interface RankingEntry {
  reviewer: string
  count: number
  pixels?: number // total pixels this reviewer changed across all reviews
}

// Pull a numeric changed-pixel total out of whichever key the backend uses.
function readPixels(e: Record<string, unknown>): number | undefined {
  for (const key of ["pixels", "changed_pixels", "changedPixels", "pixels_changed"]) {
    const v = e[key]
    if (typeof v === "number" && Number.isFinite(v)) return v
  }
  return undefined
}

// Fetch the leaderboard. Contract:
//   GET {RANKINGS_API_URL}
//   200 -> [{ "reviewer": string, "count": number, "pixels"?: number }, ...]
// We defensively re-sort by count (desc), then changed pixels (desc), in case
// the backend doesn't. `pixels` is optional so older backends still parse.
export async function fetchRankings(): Promise<RankingEntry[]> {
  const res = await fetch(RANKINGS_API_URL)
  if (!res.ok) throw new Error(`Rankings konnten nicht geladen werden (${res.status}).`)

  const data = (await res.json()) as unknown
  if (!Array.isArray(data)) throw new Error("Unerwartetes Rankings-Format vom Server.")

  return data
    .map(e => e as Record<string, unknown>)
    .filter(e => typeof e.reviewer === "string" && typeof e.count === "number")
    .map(e => ({ reviewer: e.reviewer as string, count: e.count as number, pixels: readPixels(e) }))
    .sort((a, b) => b.count - a.count || (b.pixels ?? 0) - (a.pixels ?? 0))
}
