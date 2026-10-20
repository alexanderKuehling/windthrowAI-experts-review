import { AUTH_API_URL, REGISTER_API_URL, SESSION_API_URL } from "../constants"

// Minimum password length — kept in sync with the backend (PASSWORD_MIN).
export const PASSWORD_MIN = 8

// A signed-in reviewer. `token` is the session credential the backend hands out
// on login; it is replayed on every review submission (see submitReview).
// A guest has no token: they can look around (browse tiles, try the tools, build
// presets) but can't submit — the deployed backend rejects anonymous reviews.
export interface AuthUser {
  name: string
  token: string
  guest?: boolean
}

export const GUEST_NAME = "Guest"

export function guestUser(): AuthUser {
  return { name: GUEST_NAME, token: "", guest: true }
}

// Thrown when the backend rejects the session token (expired, or signed with a
// key the backend no longer has). The UI uses this to send the reviewer back
// to the login screen.
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired — please sign in again.")
    this.name = "SessionExpiredError"
  }
}

export const SESSION_EXPIRED_NOTICE = "Your session has expired — please sign in again."

const STORAGE_KEY = "windthrow-review-auth"

// The token is `<base64url JSON payload>.<signature>` (see auth.py) and the
// payload carries its expiry. Reading it here is only a convenience — the
// backend still verifies the signature — but it means a session that ran out
// lands on the login screen instead of failing on its first request.
/** When the token stops being accepted (ms since epoch), or null if unreadable. */
export function tokenExpiresAt(token: string): number | null {
  try {
    const body = token.split(".", 1)[0].replace(/-/g, "+").replace(/_/g, "/")
    const payload = JSON.parse(atob(body)) as { exp?: unknown }
    return typeof payload.exp === "number" ? payload.exp * 1000 : null
  } catch {
    return null // not a format we can read — let the backend decide
  }
}

function tokenExpired(token: string): boolean {
  const expiresAt = tokenExpiresAt(token)
  return expiresAt !== null && expiresAt <= Date.now()
}

// Ask the backend whether the token is still accepted. Contract:
//   GET /auth/me   Authorization: Bearer <token>
//   200 -> { "name": string }   ·   401 -> invalid or expired
// Anything else (offline, a 5xx, a backend that predates /auth/me) proves
// nothing either way, so only a definite 401 counts as a dead session.
export async function sessionRejected(token: string): Promise<boolean> {
  try {
    const res = await fetch(SESSION_API_URL, { headers: { Authorization: `Bearer ${token}` } })
    return res.status === 401
  } catch {
    return false
  }
}

// Fires when another tab signs in or out. (The storage event never fires in
// the tab that made the change, and a null key means storage was cleared.)
export function watchStoredUser(onChange: (user: AuthUser | null) => void): () => void {
  function onStorage(e: StorageEvent) {
    if (e.key === STORAGE_KEY || e.key === null) onChange(loadStoredUser())
  }
  window.addEventListener("storage", onStorage)
  return () => window.removeEventListener("storage", onStorage)
}

// Restore a previous session from localStorage (survives reloads).
export function loadStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AuthUser>
    if (typeof parsed.name === "string" && typeof parsed.token === "string") {
      if (tokenExpired(parsed.token)) {
        storeUser(null)
        return null
      }
      return { name: parsed.name, token: parsed.token }
    }
  } catch {
    // corrupt / unavailable storage — treat as logged out
  }
  return null
}

function storeUser(user: AuthUser | null): void {
  try {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // storage disabled — session just won't persist across reloads
  }
}

// Shared login/register call. Both endpoints take { name, password } and return
// { token, name?, error? }; on success the token is persisted. Contract:
//   POST {url}  body: { "name": string, "password": string }
//   200 -> { "token": string, "name"?: string }
//   400 -> validation error   ·   401 -> bad credentials   ·   409 -> name taken
async function authRequest(url: string, name: string, password: string): Promise<AuthUser> {
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), password }),
    })
  } catch {
    throw new Error("Server unreachable. Please try again later.")
  }

  if (res.status === 401) throw new Error("Name or password is incorrect.")
  if (res.status === 409) throw new Error("This name is already taken.")
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(detail.error || `Failed (${res.status}).`)
  }

  const data = (await res.json().catch(() => ({}))) as Partial<AuthUser>
  if (!data.token) throw new Error("Response contained no token.")

  const user: AuthUser = { name: data.name?.trim() || name.trim(), token: data.token }
  storeUser(user)
  return user
}

// Log in an existing reviewer.
export function login(name: string, password: string): Promise<AuthUser> {
  return authRequest(AUTH_API_URL, name, password)
}

// Register a new reviewer (self-service) and sign them in.
export function register(name: string, password: string): Promise<AuthUser> {
  return authRequest(REGISTER_API_URL, name, password)
}

export function logout(): void {
  storeUser(null)
}
