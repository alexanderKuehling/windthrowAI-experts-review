import { useState } from "react"
import { login, register, PASSWORD_MIN } from "../utils/auth"
import type { AuthUser } from "../utils/auth"

type Mode = "login" | "register"

export function Login({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<Mode>("login")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
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
      setError(`Das Passwort muss mindestens ${PASSWORD_MIN} Zeichen haben.`)
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
        <h2>{isRegister ? "Registrieren" : "Anmelden"}</h2>
        <p className="login-hint">
          {isRegister
            ? "Wähle einen Anzeigenamen und ein Passwort. Bitte ein Pseudonym verwenden — keinen Klarnamen und keine E-Mail."
            : "Melde dich an, um Tiles zu reviewen und im Ranking zu erscheinen."}
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
          <span>Passwort{isRegister && <span className="login-req"> (mind. {PASSWORD_MIN} Zeichen)</span>}</span>
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
            ? isRegister ? "Registrieren…" : "Anmelden…"
            : isRegister ? "Registrieren" : "Anmelden"}
        </button>

        <p className="login-switch">
          {isRegister ? (
            <>Schon registriert?{" "}
              <button type="button" className="login-link" onClick={() => switchMode("login")} disabled={busy}>
                Anmelden
              </button>
            </>
          ) : (
            <>Noch kein Account?{" "}
              <button type="button" className="login-link" onClick={() => switchMode("register")} disabled={busy}>
                Registrieren
              </button>
            </>
          )}
        </p>
      </form>
    </div>
  )
}
