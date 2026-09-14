import { createContext, useContext } from "react"
import type { ChannelPreset } from "../utils/channels"
import type { Recipe } from "../utils/recipes"
import type { ReviewPatch } from "../utils/review"

// Shared state between the Review and Channels pages: the Channels page needs
// a tile to preview on, and both pages need the same list of custom presets
// (saved on Channels, selectable on Review). Single source of truth for
// localStorage + the server-side presets store — neither page reads/writes
// either directly.
export interface AppStateValue {
  patch: ReviewPatch | null
  setPatch: (p: ReviewPatch | null) => void
  customPresets: ChannelPreset[]
  setCustomPresets: (p: ChannelPreset[]) => void
  /** Formulas the reviewer saved by name, on top of the shipped library. */
  customRecipes: Recipe[]
  setCustomRecipes: (r: Recipe[]) => void
  /** Set when the last server sync failed (signed-in users only); the edit
   * itself still applied locally. null when everything's fine. */
  presetsSyncError: string | null
}

export const AppStateContext = createContext<AppStateValue | null>(null)

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error("useAppState must be used within an AppStateProvider")
  return ctx
}
