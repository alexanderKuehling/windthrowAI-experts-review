import { AUTH_API_URL, REGISTER_API_URL } from "../constants"

// Minimum password length — kept in sync with the backend (PASSWORD_MIN).
export const PASSWORD_MIN = 8

// A signed-in reviewer. `token` is the session credential the backend hands out
// on login; it is replayed on every review submission (see submitReview).
export interface AuthUser {
  name: string
  token: string
}

const STORAGE_KEY = "windthrow-review-auth"

// Restore a previous session from localStorage (survives reloads).
export function loadStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AuthUser>
    if (typeof parsed.name === "string" && typeof parsed.token === "string") {
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
    throw new Error("Server nicht erreichbar. Bitte später erneut versuchen.")
  }

  if (res.status === 401) throw new Error("Name oder Passwort ist falsch.")
  if (res.status === 409) throw new Error("Dieser Name ist bereits vergeben.")
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(detail.error || `Fehlgeschlagen (${res.status}).`)
  }

  const data = (await res.json().catch(() => ({}))) as Partial<AuthUser>
  if (!data.token) throw new Error("Antwort ohne Token.")

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
