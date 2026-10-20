import { useState } from "react"
import { login, register, PASSWORD_MIN } from "../utils/auth"
import type { AuthUser } from "../utils/auth"

type Mode = "login" | "register"

interface LoginProps {
  /** Why the reviewer is here, e.g. their session expired. Shown until they
   * act, the same way a failed sign-in is. */
  notice?: string | null
  onLogin: (user: AuthUser) => void
  onGuest: () => void
}

export function Login({ notice, onLogin, onGuest }: LoginProps) {
  const [mode, setMode] = useState<Mode>("login")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(notice ?? null)
  const [busy, setBusy] = useState(false)

  const isRegister = mode === "register"

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !password) return
    if (isRegister && password.length < PASSWORD_MIN) {
      setError(`The password must be at least ${PASSWORD_MIN} characters long.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      onLogin(await (isRegister ? register(name, password) : login(name, password)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <h2>{isRegister ? "Register" : "Sign in"}</h2>
        <p className="login-hint">
          {isRegister
            ? "Choose a display name and a password. Please use a pseudonym — no real name and no email."
            : "Sign in to review tiles and appear in the rankings."}
        </p>

        {error && <div className="error-box">{error}</div>}

        <label className="login-field">
          <span>Name</span>
          <input
            type="text"
            autoComplete="username"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={busy}
            required
          />
        </label>

        <label className="login-field">
          <span>Password{isRegister && <span className="login-req"> (min. {PASSWORD_MIN} characters)</span>}</span>
          <input
            type="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={busy}
            minLength={isRegister ? PASSWORD_MIN : undefined}
            required
          />
        </label>

        <button
          type="submit"
          className="login-submit"
          disabled={busy || !name.trim() || !password}
        >
          {busy
            ? isRegister ? "Registering…" : "Signing in…"
            : isRegister ? "Register" : "Sign in"}
        </button>

        <p className="login-switch">
          {isRegister ? (
            <>Already registered?{" "}
              <button type="button" className="login-link" onClick={() => switchMode("login")} disabled={busy}>
                Sign in
              </button>
            </>
          ) : (
            <>No account yet?{" "}
              <button type="button" className="login-link" onClick={() => switchMode("register")} disabled={busy}>
                Register
              </button>
            </>
          )}
        </p>

        <div className="login-divider"><span>or</span></div>

        <button
          type="button"
          className="login-guest"
          onClick={onGuest}
          disabled={busy}
        >
          Continue without signing in
        </button>
        <p className="login-guest-hint">
          Look around without an account. Submitting reviews needs one.
        </p>
      </form>
    </div>
  )
}
