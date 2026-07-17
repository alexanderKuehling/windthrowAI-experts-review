import { RANKINGS_API_URL } from "../constants"

// One reviewer's aggregated review count (the backend counts persisted reviews).
export interface RankingEntry {
  reviewer: string
  count: number
}

// Fetch the leaderboard. Contract:
//   GET {RANKINGS_API_URL}
//   200 -> [{ "reviewer": string, "count": number }, ...]
// We defensively re-sort by count (desc) in case the backend doesn't.
export async function fetchRankings(): Promise<RankingEntry[]> {
  const res = await fetch(RANKINGS_API_URL)
  if (!res.ok) throw new Error(`Rankings konnten nicht geladen werden (${res.status}).`)

  const data = (await res.json()) as unknown
  if (!Array.isArray(data)) throw new Error("Unerwartetes Rankings-Format vom Server.")

  return data
    .map(e => e as Partial<RankingEntry>)
    .filter((e): e is RankingEntry => typeof e.reviewer === "string" && typeof e.count === "number")
    .sort((a, b) => b.count - a.count)
}
