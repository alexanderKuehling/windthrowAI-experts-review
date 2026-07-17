import { useCallback, useEffect, useState } from "react"
import { fetchRankings } from "../utils/rankings"
import type { RankingEntry } from "../utils/rankings"

// Leaderboard of reviewers by number of submitted reviews. `currentUser` is
// highlighted so the signed-in reviewer can spot their own row.
export function Rankings({ currentUser }: { currentUser: string }) {
  const [entries, setEntries] = useState<RankingEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setEntries(await fetchRankings())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="rankings">
      <div className="rankings-titlebar">
        <h2>Ranking</h2>
        <button className="tab-btn" onClick={() => void load()} disabled={loading}>
          {loading ? "Aktualisieren…" : "Aktualisieren"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {loading && !entries && (
        <div className="rankings-loading">
          <div className="spinner" />
          <p>Ranking wird geladen…</p>
        </div>
      )}

      {entries && entries.length === 0 && !error && (
        <p className="rankings-empty">Noch keine Reviews vorhanden.</p>
      )}

      {entries && entries.length > 0 && (
        <ol className="rankings-list">
          {entries.map((e, i) => {
            const isMe = e.reviewer === currentUser
            return (
              <li key={e.reviewer} className={`rankings-row ${isMe ? "rankings-row-me" : ""}`}>
                <span className={`rankings-rank rankings-rank-${i + 1 <= 3 ? i + 1 : "n"}`}>
                  {i + 1}
                </span>
                <span className="rankings-name">
                  {e.reviewer}
                  {isMe && <span className="rankings-you"> (du)</span>}
                </span>
                <span className="rankings-count">
                  {e.count}
                  <span className="rankings-count-label"> Reviews</span>
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
