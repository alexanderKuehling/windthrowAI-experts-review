import { useEffect, useRef } from "react"
import { sessionRejected, tokenExpiresAt, watchStoredUser } from "../utils/auth"
import type { AuthUser } from "../utils/auth"

// How often an open, visible tab re-asks the backend whether the session is
// still accepted. Expiry itself is caught on the dot by a timer; this catches
// the rest (the backend's signing key changed, a token revoked by a redeploy).
const RECHECK_MS = 5 * 60 * 1000

// setTimeout's delay is a signed 32-bit int; anything longer fires at once.
const MAX_TIMEOUT_MS = 2 ** 31 - 1

/**
 * Keeps a signed-in reviewer's session honest for as long as the app is open,
 * not only when they submit: signs them out the moment the token expires,
 * re-checks it with the backend every few minutes and whenever the tab comes
 * back into view, and follows sign-in/out from other tabs. Guests have no
 * session to check.
 */
export function useSessionGuard(
  user: AuthUser | null,
  onExpired: () => void,
  onStoredUserChange: (user: AuthUser | null) => void,
) {
  // Callbacks in refs, so App re-rendering with new closures never tears down
  // and restarts the timers below.
  const onExpiredRef = useRef(onExpired)
  const onStoredUserChangeRef = useRef(onStoredUserChange)
  useEffect(() => {
    onExpiredRef.current = onExpired
    onStoredUserChangeRef.current = onStoredUserChange
  })

  const token = user && !user.guest ? user.token : null

  useEffect(() => {
    if (!token) return
    const sessionToken = token
    let stopped = false
    const expiresAt = tokenExpiresAt(sessionToken)

    function expire() {
      if (stopped) return
      stopped = true
      onExpiredRef.current()
    }

    async function check() {
      if (stopped) return
      if (expiresAt !== null && expiresAt <= Date.now()) return expire()
      if (await sessionRejected(sessionToken)) expire()
    }

    function onVisible() {
      if (document.visibilityState === "visible") void check()
    }

    void check()
    const remaining = expiresAt === null ? null : expiresAt - Date.now()
    const expiryTimer =
      remaining !== null && remaining <= MAX_TIMEOUT_MS ? setTimeout(expire, remaining) : undefined
    const recheck = setInterval(onVisible, RECHECK_MS)
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      stopped = true
      clearTimeout(expiryTimer)
      clearInterval(recheck)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [token])

  useEffect(() => watchStoredUser(next => onStoredUserChangeRef.current(next)), [])
}
