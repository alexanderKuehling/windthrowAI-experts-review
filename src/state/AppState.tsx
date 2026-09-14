import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  fetchPresetBundle,
  loadCustomPresets,
  pushPresetBundle,
  saveCustomPresets,
} from "../utils/channels"
import type { ChannelPreset, PresetBundle } from "../utils/channels"
import { loadCustomRecipes, saveCustomRecipes } from "../utils/recipes"
import type { Recipe } from "../utils/recipes"
import type { ReviewPatch } from "../utils/review"
import { AppStateContext } from "./appStateContext"

interface AppStateProviderProps {
  children: ReactNode
  /** Signed-in reviewer's session token — omitted for guests. When present,
   * custom presets and saved formulas are persisted server-side (per reviewer)
   * instead of only in this browser's localStorage. */
  token?: string
}

export function AppStateProvider({ children, token }: AppStateProviderProps) {
  const [patch, setPatch] = useState<ReviewPatch | null>(null)
  // Presets and saved formulas share one document server-side, so they're held
  // as one value here too: saving either has to send both, and splitting them
  // into two states would only invite sending a stale half.
  // Always seed from localStorage first (works offline, no loading flash),
  // then reconcile with the server below once a token is available.
  const [bundle, setBundle] = useState<PresetBundle>(() => ({
    presets: loadCustomPresets(),
    recipes: loadCustomRecipes(),
  }))
  const [presetsSyncError, setPresetsSyncError] = useState<string | null>(null)

  // Guards a race between the initial server fetch and a save the user makes
  // before it resolves — the fetch must never clobber a newer local edit.
  const dirtyRef = useRef(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetchPresetBundle(token)
      .then(remote => {
        if (cancelled || dirtyRef.current) return
        setBundle(remote)
        // Keep the local cache in step for offline/guest fallback.
        saveCustomPresets(remote.presets)
        saveCustomRecipes(remote.recipes)
      })
      .catch(e => {
        if (!cancelled) setPresetsSyncError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [token])

  function commit(next: PresetBundle) {
    dirtyRef.current = true
    setBundle(next)
    saveCustomPresets(next.presets) // local cache, always — guests stop here
    saveCustomRecipes(next.recipes)
    if (!token) return
    pushPresetBundle(token, next)
      .then(() => setPresetsSyncError(null))
      .catch(e => setPresetsSyncError(e instanceof Error ? e.message : String(e)))
  }

  function setCustomPresets(presets: ChannelPreset[]) {
    commit({ presets, recipes: bundle.recipes })
  }

  function setCustomRecipes(recipes: Recipe[]) {
    commit({ presets: bundle.presets, recipes })
  }

  const value = useMemo(
    () => ({
      patch,
      setPatch,
      customPresets: bundle.presets,
      setCustomPresets,
      customRecipes: bundle.recipes,
      setCustomRecipes,
      presetsSyncError,
    }),
    [patch, bundle, presetsSyncError],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}
